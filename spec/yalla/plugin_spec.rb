# frozen_string_literal: true

RSpec.describe "Yalla safety net: discourse-forward-trust plugin" do
  it "is loaded" do
    expect(Discourse.plugins.map(&:name)).to include("discourse-forward-trust")
  end
end
