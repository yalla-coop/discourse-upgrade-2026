# frozen_string_literal: true

# Yalla safety net: custom changes to Discourse core that the app (via Prose)
# relies on.
#
# These tests pin down how production behaves today (tag
# baseline/prod-3.4.0.beta4-dev). They must pass unchanged after every upgrade
# hop. If one fails after a hop, a behaviour the app relies on changed.
#
# Run with: LOAD_PLUGINS=1 bin/rspec spec/yalla
RSpec.describe "Yalla safety net: core changes", type: :request do
  fab!(:user)

  describe "category group_permissions (site.json, categories)" do
    fab!(:group) { Fabricate(:group, visibility_level: Group.visibility_levels[:public]) }

    def group_permissions_for(category)
      BasicCategorySerializer.new(category, scope: Guardian.new(user), root: false).as_json[
        :group_permissions
      ]
    end

    it "reports 'everyone' with full access for a public category" do
      category = Fabricate(:category)

      expect(group_permissions_for(category)).to contain_exactly(
        { permission_type: CategoryGroup.permission_types[:full], group_name: "everyone" },
      )
    end

    it "lists the groups of a restricted category" do
      category = Fabricate(:private_category, group: group)
      group.add(user)

      expect(group_permissions_for(category)).to contain_exactly(
        { permission_type: CategoryGroup.permission_types[:full], group_name: group.name },
      )
    end

    # Prose reads group_permissions from these two endpoints
    # (categoryQuery.ts, showCategoryQuery.ts).
    it "is included for categories in /categories.json" do
      category = Fabricate(:private_category, group: group)
      group.add(user)
      sign_in(user)

      get "/categories.json", params: { include_subcategories: true }

      expect(response.status).to eq(200)
      json_category =
        response.parsed_body["category_list"]["categories"].find { |c| c["id"] == category.id }
      expect(json_category["group_permissions"]).to contain_exactly(
        { "permission_type" => CategoryGroup.permission_types[:full], "group_name" => group.name },
      )
    end

    # Stock Discourse behaviour, recorded as it is today: the full category
    # serializer only shows group_permissions to people who can edit the category.
    it "is included in /c/{id}/show.json for admins only" do
      category = Fabricate(:private_category, group: group)
      group.add(user)

      sign_in(user)
      get "/c/#{category.id}/show.json"
      expect(response.status).to eq(200)
      expect(response.parsed_body["category"]).not_to have_key("group_permissions")

      sign_in(Fabricate(:admin))
      get "/c/#{category.id}/show.json"
      expect(response.parsed_body["category"]["group_permissions"]).to contain_exactly(
        { "permission_type" => CategoryGroup.permission_types[:full], "group_name" => group.name },
      )
    end

    it "is included for categories in /site.json" do
      category = Fabricate(:category)
      sign_in(user)

      get "/site.json"

      expect(response.status).to eq(200)
      json_category = response.parsed_body["categories"].find { |c| c["id"] == category.id }
      expect(json_category["group_permissions"]).to be_present
    end
  end

  describe "post previews keep full HTML, links and images" do
    let(:raw) { "Read the [support guide](https://example.com/guide) before the meeting." }
    let(:post) { Fabricate(:post, raw: raw) }

    it "returns the full cooked HTML as the post excerpt" do
      expect(post.excerpt).to eq(post.cooked)
    end

    it "keeps links in the topic excerpt" do
      expect(post.excerpt_for_topic).to include('href="https://example.com/guide"')
    end

    it "keeps links even when a caller asks to strip them" do
      excerpt =
        PrettyText.excerpt(
          '<p>See <a href="https://example.com/guide">the guide</a></p>',
          100,
          strip_links: true,
        )

      expect(excerpt).to include('href="https://example.com/guide"')
    end

    it "turns uploaded videos into a [Video](url) link" do
      html =
        '<p>Watch this</p><div class="video-placeholder-container" data-video-src="/uploads/default/original/1X/clip.mp4"></div>'

      expect(PrettyText.excerpt(html, 200)).to include(
        "[Video](/uploads/default/original/1X/clip.mp4)",
      )
    end
  end

  describe "flagged_by_user on topics" do
    fab!(:topic)
    fab!(:first_post) { Fabricate(:post, topic: topic) }

    def flag_first_post
      PostAction.create!(
        user: user,
        post: first_post,
        post_action_type_id: PostActionType.types[:spam],
      )
    end

    it "is false in topic lists until the user flags the topic" do
      json = TopicListItemSerializer.new(topic, scope: Guardian.new(user), root: false).as_json
      expect(json[:flagged_by_user]).to eq(false)

      flag_first_post
      json =
        TopicListItemSerializer.new(topic.reload, scope: Guardian.new(user), root: false).as_json
      expect(json[:flagged_by_user]).to eq(true)
    end

    it "is true on the topic page after the user flags it" do
      flag_first_post
      topic_view = TopicView.new(topic.id, user)

      json = TopicViewSerializer.new(topic_view, scope: Guardian.new(user), root: false).as_json
      expect(json[:flagged_by_user]).to eq(true)
    end

    it "is false for another user who did not flag it" do
      flag_first_post
      other = Fabricate(:user)

      json = TopicListItemSerializer.new(topic, scope: Guardian.new(other), root: false).as_json
      expect(json[:flagged_by_user]).to eq(false)
    end
  end

  describe "search results" do
    before do
      SearchIndexer.enable
      SiteSetting.min_search_term_length = 2
    end

    it "include cooked HTML on posts and flagged_by_user on topics" do
      post = Fabricate(:post, raw: "Weekly recovery circle meets on Thursday evenings")
      SearchIndexer.index(post.topic, force: true)
      SearchIndexer.index(post, force: true)
      sign_in(user)

      get "/search.json", params: { q: "recovery circle" }

      expect(response.status).to eq(200)
      json_post = response.parsed_body["posts"].find { |p| p["id"] == post.id }
      json_topic = response.parsed_body["topics"].find { |t| t["id"] == post.topic_id }
      expect(json_post["cooked"]).to eq(post.cooked)
      expect(json_topic).to have_key("flagged_by_user")
    end
  end

  describe "group owner email when a new user confirms their email" do
    fab!(:owner) { Fabricate(:user) }
    fab!(:new_user) { Fabricate(:user, active: false) }

    def mails_to(address)
      ActionMailer::Base.deliveries.select { |mail| mail.to.include?(address) }
    end

    def group_with_owner(full_name:)
      Fabricate(:group, full_name: full_name).tap do |group|
        group.add_owner(owner)
        group.add(new_user)
      end
    end

    def confirm(scope)
      token = Fabricate(:email_token, user: new_user, scope: EmailToken.scopes[scope])
      EmailToken.confirm(token.token, scope: EmailToken.scopes[scope])
    end

    before { ActionMailer::Base.deliveries.clear }

    it "emails the owner of a holding group on signup, with holding wording" do
      group_with_owner(full_name: "North London Holding")

      confirm(:signup)

      mail = mails_to(owner.email).last
      expect(mail).to be_present
      expect(mail.subject).to eq("New user registered to your holding group")
      expect(mail.body.to_s).to include(new_user.username, new_user.email, "North London Holding")
    end

    it "uses plain group wording for groups that are not holding groups" do
      group_with_owner(full_name: "Peer Mentors")

      confirm(:signup)

      expect(mails_to(owner.email).last.subject).to eq("New user registered to your group")
    end

    it "does not email the owner when a user resets their password" do
      group_with_owner(full_name: "North London Holding")
      new_user.update!(active: true)

      confirm(:password_reset)

      expect(mails_to(owner.email)).to be_empty
    end
  end
end
