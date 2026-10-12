# frozen_string_literal: true

# Seeds the LOCAL Docker dev database with the data the Layer B contract checks
# need: members, a group, public and private categories, topics, a reply, a
# private message, a poll, chat channels and messages.
#
# Never run this against staging or production. It refuses to run outside the
# development environment.
#
# Usage (inside the hop container):
#   LOAD_PLUGINS=1 bin/rails runner contract/seed/docker_seed.rb
#
# It is idempotent: running it twice reuses what already exists. It writes the
# credentials the checks use to contract/.local/docker.json (git-ignored).

abort "Refusing to seed: only for the local Docker dev database" if !Rails.env.development?

Jobs.run_immediately!
RateLimiter.disable

PASSWORD = "contract-checks-2026!"

SiteSetting.chat_enabled = true
SiteSetting.chat_allowed_groups = Group::AUTO_GROUPS[:everyone]
SiteSetting.direct_message_enabled_groups = Group::AUTO_GROUPS[:everyone]
SiteSetting.personal_message_enabled_groups = Group::AUTO_GROUPS[:everyone]
SiteSetting.tagging_enabled = true
SiteSetting.enable_user_status = true
SiteSetting.discourse_reactions_enabled = true if SiteSetting.respond_to?(
  :discourse_reactions_enabled=,
)

# Local Docker copy only: no waiting between posts, so the write checks can
# create a topic and reply to it in the same run.
SiteSetting.rate_limit_create_post = 0
SiteSetting.rate_limit_new_user_create_post = 0
SiteSetting.rate_limit_create_topic = 0

def user!(username, admin: false)
  user = User.find_by(username: username)
  return user if user

  user =
    User.create!(
      username: username,
      name: username.titleize,
      email: "#{username}@example.com",
      password: PASSWORD,
      active: true,
      approved: true,
      trust_level: TrustLevel[2],
      admin: admin,
    )
  user.email_tokens.update_all(confirmed: true)
  user
end

admin = user!("contract_admin", admin: true)
member = user!("contract_member")
member2 = user!("contract_member2")

group =
  Group.find_by(name: "peer_mentors") ||
    Group.create!(
      name: "peer_mentors",
      full_name: "Peer Mentors",
      visibility_level: Group.visibility_levels[:public],
      messageable_level: Group::ALIAS_LEVELS[:everyone],
    )
group.add_owner(admin) if !group.group_users.exists?(user_id: admin.id)
[member, member2].each { |u| group.add(u) if !group.group_users.exists?(user_id: u.id) }

general =
  Category.find_by(name: "Contract General") ||
    Category.create!(name: "Contract General", user: admin)

mentors =
  Category.find_by(name: "Contract Mentors") ||
    Category
      .create!(name: "Contract Mentors", user: admin)
      .tap do |c|
        c.set_permissions(group.name => :full)
        c.save!
      end

Tag.find_or_create_by!(name: "wellbeing")

topic =
  Topic.find_by(title: "Weekly recovery circle meets on Thursday evenings") ||
    PostCreator.create!(
      member,
      title: "Weekly recovery circle meets on Thursday evenings",
      raw:
        "Read the [support guide](https://example.com/guide) before the meeting.\n\n[poll type=regular]\n* Yes, I'll be there\n* Not this week\n[/poll]",
      category: general.id,
      tags: ["wellbeing"],
    ).topic

if topic.posts_count < 2
  PostCreator.create!(
    member2,
    topic_id: topic.id,
    raw: "Looking forward to it, I'll bring the reading list.",
    reply_to_post_number: 1,
  )
end

# The member needs a "replied" notification for the notification checks.
reply = topic.posts.find_by(post_number: 2)
if !Notification.exists?(user: member, notification_type: Notification.types[:replied])
  PostAlerter.post_created(reply)
end
if !Notification.exists?(user: member, notification_type: Notification.types[:replied])
  Notification.create!(
    user: member,
    notification_type: Notification.types[:replied],
    topic_id: topic.id,
    post_number: reply.post_number,
    data: {
      topic_title: topic.title,
      original_post_id: reply.id,
      original_post_type: reply.post_type,
      original_username: member2.username,
      display_username: member2.username,
    }.to_json,
  )
end

# The member ignores a separate user, so `ignored_usernames` has a value to
# check without hiding anyone the other checks rely on.
ignored = user!("contract_ignored")
IgnoredUser.find_or_create_by!(user: member, ignored_user: ignored) do |row|
  row.expiring_at = 1.year.from_now
end

Topic.find_by(title: "Mentor rota for the next quarter") ||
  PostCreator.create!(
    admin,
    title: "Mentor rota for the next quarter",
    raw: "Please add your availability for the next quarter below.",
    category: mentors.id,
  )

Topic.find_by(title: "Checking in after this week's session") ||
  PostCreator.create!(
    member,
    title: "Checking in after this week's session",
    raw: "Just wanted to check in and see how you're doing after Thursday.",
    archetype: Archetype.private_message,
    target_usernames: member2.username,
  )

channel =
  Chat::Channel.find_by(chatable: general) ||
    Chat::CategoryChannel.create!(
      chatable: general,
      name: "Contract General",
      slug: "contract-general",
    )

def follow!(channel, user)
  membership =
    Chat::UserChatChannelMembership.find_or_initialize_by(chat_channel: channel, user: user)
  membership.following = true
  membership.save!
end

[admin, member, member2].each { |u| follow!(channel, u) }

if !Chat::Message.exists?(chat_channel: channel)
  Chat::Message.create!(
    chat_channel: channel,
    user: member2,
    message: "Welcome to the channel, everyone.",
    cooked: "<p>Welcome to the channel, everyone.</p>",
  )
end

dm = Chat::DirectMessage.for_user_ids([member.id, member2.id])
if !dm
  dm = Chat::DirectMessage.create!(user_ids: [member.id, member2.id])
  dm_channel = Chat::DirectMessageChannel.create!(chatable: dm)
  [member, member2].each { |u| follow!(dm_channel, u) }
  Chat::Message.create!(
    chat_channel: dm_channel,
    user: member2,
    message: "Hi, are you coming on Thursday?",
    cooked: "<p>Hi, are you coming on Thursday?</p>",
  )
end

# The "top" topic lists are built by a daily job; build them now.
TopTopic.refresh!

# The plain key is only readable right after creation, so each run makes a new one.
api_key = ApiKey.create!(user: admin, created_by: admin, description: "contract checks")

config = {
  base_url: "http://localhost:3000",
  member: {
    username: member.username,
    email: member.email,
    password: PASSWORD,
  },
  member2: {
    username: member2.username,
    password: PASSWORD,
  },
  admin: {
    username: admin.username,
    api_key: api_key.key,
  },
}

dir = Rails.root.join("contract/.local")
FileUtils.mkdir_p(dir)
File.write(dir.join("docker.json"), JSON.pretty_generate(config))
puts "Seeded. Credentials written to contract/.local/docker.json"
