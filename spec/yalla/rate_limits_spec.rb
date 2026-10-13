# frozen_string_literal: true

# Yalla safety net: request rate limits.
#
# All app traffic reaches Discourse from Prose's few IP addresses, so the
# per-IP and per-user API limits have to be far above Discourse's defaults or
# members start getting "too many requests". After the plugin move these values
# are delivered as DISCOURSE_* environment variables from
# deploy/forward-trust.env (copied into the env section of production's
# app.yml). The test environment ignores environment variables (GlobalSetting
# reads only discourse_defaults.conf there), so this test checks the file.
RSpec.describe "Yalla safety net: rate limits" do
  REQUIRED_RATE_LIMIT_SETTINGS = {
    "max_user_api_reqs_per_minute" => "1000000",
    "max_user_api_reqs_per_day" => "100000000",
    "max_admin_api_reqs_per_minute" => "1000000",
    "max_reqs_per_ip_per_minute" => "1000000",
    "max_reqs_per_ip_per_10_seconds" => "1000000",
    "max_asset_reqs_per_ip_per_10_seconds" => "1000000",
    "max_reqs_per_ip_mode" => "warn",
    "skip_per_ip_rate_limit_trust_level" => "0",
  }.freeze

  def env_file_settings
    Rails
      .root
      .join("deploy/forward-trust.env")
      .readlines
      .map(&:strip)
      .reject { |line| line.empty? || line.start_with?("#") }
      .to_h do |line|
        key, value = line.split("=", 2)
        [key.delete_prefix("DISCOURSE_").downcase, value]
      end
  end

  it "sets exactly the per-IP and API limits Prose needs in deploy/forward-trust.env" do
    expect(env_file_settings).to eq(REQUIRED_RATE_LIMIT_SETTINGS)
  end

  it "only names real Discourse global settings" do
    env_file_settings.each_key { |name| expect(GlobalSetting).to respond_to(name) }
  end
end
