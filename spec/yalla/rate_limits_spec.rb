# frozen_string_literal: true

# Yalla safety net: request rate limits.
#
# All app traffic reaches Discourse from Prose's few IP addresses, so the
# per-IP and per-user API limits have to be far above Discourse's defaults or
# members start getting "too many requests". Production sets them in
# config/discourse_defaults.conf today; after the plugin move they come from
# deploy/forward-trust.env (DISCOURSE_* environment variables).
RSpec.describe "Yalla safety net: rate limits" do
  it "keeps the per-IP and API limits high enough for Prose" do
    expect(GlobalSetting.max_user_api_reqs_per_minute.to_i).to eq(1_000_000)
    expect(GlobalSetting.max_user_api_reqs_per_day.to_i).to eq(100_000_000)
    expect(GlobalSetting.max_admin_api_reqs_per_minute.to_i).to eq(1_000_000)
    expect(GlobalSetting.max_reqs_per_ip_per_minute.to_i).to eq(1_000_000)
    expect(GlobalSetting.max_reqs_per_ip_per_10_seconds.to_i).to eq(1_000_000)
    expect(GlobalSetting.max_asset_reqs_per_ip_per_10_seconds.to_i).to eq(1_000_000)
    expect(GlobalSetting.max_reqs_per_ip_mode.to_s).to eq("warn")
    expect(GlobalSetting.skip_per_ip_rate_limit_trust_level.to_i).to eq(0)
  end
end
