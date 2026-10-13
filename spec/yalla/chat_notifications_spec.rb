# frozen_string_literal: true

# Yalla safety net: chat notifications.
#
# These tests pin down how chat notifications behave on production today
# (tag baseline/prod-3.4.0.beta4-dev). They must pass unchanged after every
# upgrade hop. If one fails after a hop, a behaviour the app relies on changed.
#
# Run with: LOAD_PLUGINS=1 bin/rspec spec/yalla
RSpec.describe "Yalla safety net: chat notifications", type: :request do
  fab!(:sender) { Fabricate(:user) }
  fab!(:member) { Fabricate(:user) }
  fab!(:channel) { Fabricate(:category_channel) }

  before do
    SiteSetting.chat_enabled = true
    SiteSetting.chat_allowed_groups = Group::AUTO_GROUPS[:everyone]
  end

  def join(user, **attrs)
    Fabricate(:user_chat_channel_membership, user: user, chat_channel: channel, **attrs)
  end

  # Sends the notifications for a message the way Discourse does after it is
  # created (Chat::Notifier#notify_new), running the resulting jobs straight
  # away. The tests then check the outcome (notification rows and the event
  # the Lexicon plugin listens to), whichever job produces it.
  def notify_new(message)
    Jobs.run_immediately!
    Chat::Notifier.new(message, message.created_at).notify_new
  end

  def lexicon_events_for(user, &block)
    DiscourseEvent
      .track_events(:created_chat_notification, &block)
      .select { |event| event[:params][1] == user.id }
  end

  def chat_notifications_for(user)
    Notification.where(user: user, notification_type: Notification.types[:chat_message])
  end

  describe "new channel memberships" do
    it "default to notifying always, on desktop and on mobile" do
      membership = Chat::UserChatChannelMembership.new

      expect(membership.desktop_notification_level).to eq("always")
      expect(membership.mobile_notification_level).to eq("always")
    end
  end

  describe "a message in a channel the member watches" do
    before { join(sender) }

    let!(:membership) do
      join(member, notification_level: :always, mobile_notification_level: :always)
    end
    let!(:message) { Fabricate(:chat_message, chat_channel: channel, user: sender) }

    it "creates exactly one chat_message notification for the member" do
      expect { notify_new(message) }.to change { chat_notifications_for(member).count }.by(1)

      data = JSON.parse(chat_notifications_for(member).last.data)
      expect(data).to include(
        "chat_message_id" => message.id,
        "chat_channel_id" => channel.id,
        "sender" => sender.username,
        "message" => message.message,
        "is_direct_message_channel" => false,
      )
    end

    # The Lexicon plugin listens to this event to send chat push notifications
    # (discourse-lexicon-plugin/plugin.rb). If it stops firing, chat pushes stop
    # silently.
    it "fires :created_chat_notification once for the Lexicon plugin" do
      events = lexicon_events_for(member) { notify_new(message) }

      expect(events.size).to eq(1)
      payload, _user_id, notification_type = events.first[:params]
      expect(notification_type).to eq(Notification.types[:chat_message])
      expect(payload).to include(chat_message_id: message.id, sender: sender.username)
    end

    # Production waited 5 seconds so an active reader's client can advance
    # last_read first; otherwise people get pushed messages they are reading.
    # Plugin-specific (names the plugin's job), so it can't run on production code.
    it "waits 5 seconds before deciding who to notify" do
      freeze_time
      Jobs.run_later!

      expect_enqueued_with(
        job: Jobs::DiscourseForwardTrust::ChatMessageNotifications,
        args: {
          chat_message_id: message.id,
        },
        at: Time.zone.now + 5.seconds,
      ) { Chat::Notifier.new(message, message.created_at).notify_new }
    end

    it "creates exactly one notification and one event per member" do
      events = lexicon_events_for(member) { notify_new(message) }

      expect(
        chat_notifications_for(member).where("data::json->>'chat_message_id' = ?", message.id.to_s).count,
      ).to eq(1)
      expect(events.size).to eq(1)
    end
  end

  describe "a member who turned mobile notifications off" do
    before { join(sender) }

    let!(:membership) do
      join(member, notification_level: :always, mobile_notification_level: :never)
    end
    let!(:message) { Fabricate(:chat_message, chat_channel: channel, user: sender) }

    it "gets no notification and no Lexicon event" do
      events = lexicon_events_for(member) { notify_new(message) }

      expect(chat_notifications_for(member).count).to eq(0)
      expect(events).to be_empty
    end
  end

  describe "a member whose mobile level is 'mention'" do
    before { join(sender) }

    let!(:membership) do
      join(member, notification_level: :always, mobile_notification_level: :mention)
    end

    it "is notified when mentioned" do
      message =
        Fabricate(:chat_message, chat_channel: channel, user: sender, message: "hi @#{member.username}")

      events = lexicon_events_for(member) { notify_new(message) }

      expect(events.size).to eq(1)
    end

    it "is not notified for a message that doesn't mention them" do
      message = Fabricate(:chat_message, chat_channel: channel, user: sender, message: "hello all")

      events = lexicon_events_for(member) { notify_new(message) }

      expect(events).to be_empty
    end
  end

  describe "messages sent before the member joined" do
    before { join(sender) }

    it "are not counted as unread" do
      Fabricate(:chat_message, chat_channel: channel, user: sender, created_at: 1.hour.ago)
      join(member)

      unread = Chat::ChannelUnreadsQuery.call(channel_ids: [channel.id], user_id: member.id).first
      expect(unread.unread_count).to eq(0)
    end

    it "are not counted as unread when the member is auto-joined in bulk" do
      channel.update!(auto_join_users: true)
      member.update!(last_seen_at: 1.hour.ago)
      member.user_option.update!(chat_enabled: true)
      Fabricate(:chat_message, chat_channel: channel, user: sender, created_at: 1.hour.ago)

      Chat::AutoJoinChannels.call(params: { user_id: member.id, channel_id: channel.id })

      expect(Chat::UserChatChannelMembership.exists?(user: member, chat_channel: channel)).to eq(
        true,
      )
      unread = Chat::ChannelUnreadsQuery.call(channel_ids: [channel.id], user_id: member.id).first
      expect(unread.unread_count).to eq(0)
    end

    it "does count messages sent after joining" do
      join(member, created_at: 1.hour.ago)
      Fabricate(:chat_message, chat_channel: channel, user: sender)

      unread = Chat::ChannelUnreadsQuery.call(channel_ids: [channel.id], user_id: member.id).first
      expect(unread.unread_count).to eq(1)
    end
  end

  describe "existing memberships when the plugin is installed" do
    before { join(sender) }

    # Production has memberships whose pre-join messages were hidden by edited
    # SQL. With stock SQL they would suddenly count as unread, so the plugin's
    # one-time migration marks them read.
    it "backfill marks pre-join messages read for existing memberships" do
      Fabricate(:chat_message, chat_channel: channel, user: sender, created_at: 2.hours.ago)
      membership = join(member, created_at: 1.hour.ago)
      membership.update_column(:last_read_message_id, nil)
      Fabricate(:chat_message, chat_channel: channel, user: sender)

      # Runs the migration's own SQL (it has already run on this database).
      require Rails.root.join(
                "plugins/discourse-forward-trust/db/migrate/20261013120001_forward_trust_backfill_chat_last_read",
              )
      ForwardTrustBackfillChatLastRead.new.up

      unread = Chat::ChannelUnreadsQuery.call(channel_ids: [channel.id], user_id: member.id).first
      expect(unread.unread_count).to eq(1)
    end
  end

  # Ruling R13: production's chat summary email query is broken, so it has never
  # sent these emails. The plugin keeps that (setting off by default).
  describe "chat summary emails for members who are away" do
    before do
      join(sender)
      join(member, created_at: 1.hour.ago)
      member.update!(last_seen_at: 1.hour.ago)
      member.user_option.update!(
        chat_enabled: true,
        chat_email_frequency: UserOption.chat_email_frequencies[:when_away],
        email_level: UserOption.email_level_types[:always],
      )
      message =
        Fabricate(:chat_message, chat_channel: channel, user: sender, message: "hi @#{member.username}")
      notify_new(message)
      ActionMailer::Base.deliveries.clear
    end

    it "sends none by default, even with an unread mention" do
      Chat::Mailer.send_unread_mentions_summary

      expect(ActionMailer::Base.deliveries.map(&:to).flatten).not_to include(member.email)
    end
  end

  describe "chat serializers the app reads" do
    it "includes admin on chatable users" do
      admin = Fabricate(:admin)
      json =
        Chat::ChatableUserSerializer.new(admin, scope: Guardian.new(member), root: false).as_json

      expect(json[:admin]).to eq(true)
    end

    it "includes ignored_usernames on the user serializer" do
      ignored = Fabricate(:user)
      Fabricate(:ignored_user, user: member, ignored_user: ignored)

      json = UserSerializer.new(member, scope: Guardian.new(member), root: false).as_json
      expect(json[:ignored_usernames]).to contain_exactly(ignored.username)
    end

    # Prose (availableUsersQuery.ts) reads groups[].users[].model with no guard:
    # if `users` disappears, the "new chat" screen breaks.
    it "includes each group's users, with admin, in /chat/api/chatables" do
      SiteSetting.direct_message_enabled_groups = Group::AUTO_GROUPS[:everyone]
      group = Fabricate(:public_group, name: "peer_mentors")
      admin = Fabricate(:admin)
      group.add(admin)
      group.add(member)
      sign_in(member)

      get "/chat/api/chatables.json", params: { term: "peer_mentors" }

      expect(response.status).to eq(200)
      json_group = response.parsed_body["groups"].find { |g| g["model"]["name"] == "peer_mentors" }
      expect(json_group["users"].map { |u| u["identifier"] }).to include(
        "u-#{admin.id}",
        "u-#{member.id}",
      )
      json_admin = json_group["users"].find { |u| u["identifier"] == "u-#{admin.id}" }
      expect(json_admin["type"]).to eq("user")
      expect(json_admin["model"]).to include("username" => admin.username, "admin" => true)
    end

    it "says you cannot chat with yourself on your own user card" do
      json = UserCardSerializer.new(member, scope: Guardian.new(member), root: false).as_json

      expect(json[:can_chat_user]).to eq(false)
    end

    it "says you cannot chat with yourself even when direct messages are allowed, but can chat with someone else" do
      SiteSetting.direct_message_enabled_groups = Group::AUTO_GROUPS[:everyone]
      guardian = Guardian.new(member)

      [UserCardSerializer, HiddenProfileSerializer].each do |serializer|
        own = serializer.new(member, scope: guardian, root: false).as_json
        other = serializer.new(sender, scope: guardian, root: false).as_json

        expect(own[:can_chat_user]).to eq(false), "#{serializer} for yourself"
        expect(other[:can_chat_user]).to eq(true), "#{serializer} for someone else"
      end
    end
  end
end
