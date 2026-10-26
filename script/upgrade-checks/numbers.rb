# Rehearsal numbers: counts and fingerprints only, never content.
#   rails r /shared/rehearsal/numbers.rb before|after
# Writes /shared/rehearsal/<label>.txt and prints a short summary.
require "digest"
require "openssl"
require "securerandom"

label = ARGV[0] || "before"
dir = ENV.fetch("REHEARSAL_DIR", "/shared/rehearsal")
salt_file = "#{dir}/salt"
File.write(salt_file, SecureRandom.hex(32)) unless File.exist?(salt_file)
salt = File.read(salt_file)
fp = ->(value) { OpenSSL::HMAC.hexdigest("SHA256", salt, value.to_s)[0, 16] }

conn = ActiveRecord::Base.connection
lines = []
lines << "version #{Discourse::VERSION::STRING} #{Discourse.git_version}"
conn.tables.sort.each do |t|
  lines << "count #{t} #{conn.select_value("SELECT count(*) FROM #{conn.quote_table_name(t)}").to_i}"
end
files = Dir.glob("#{ENV.fetch("UPLOADS_DIR", "/shared/uploads")}/**/*").select { |f| File.file?(f) }
lines << "upload_files #{files.size}"
lines << "upload_bytes #{files.sum { |f| File.size(f) }}"
settings = conn.select_rows("SELECT name, value FROM site_settings ORDER BY name")
settings.each { |name, value| lines << "setting #{name} #{fp.(value)}" }
Discourse.plugins.map(&:name).sort.each { |name| lines << "plugin #{name}" }
File.write("#{dir}/#{label}.txt", lines.join("\n") + "\n")

db_bytes = conn.select_value("SELECT pg_database_size(current_database())").to_i
counts = lines.grep(/^count /).to_h { |l| l.split[1..2] }
puts "== #{label}: #{lines.first}"
puts "tables #{counts.size} | users #{counts["users"]} | topics #{counts["topics"]} | posts #{counts["posts"]} | uploads #{counts["uploads"]} | groups #{counts["groups"]} | categories #{counts["categories"]}"
puts "upload files #{files.size} (#{(files.sum { |f| File.size(f) } / 1024.0**2).round} MB)"
puts "site settings changed from default: #{settings.size} | plugins: #{Discourse.plugins.size}"
puts "database #{(db_bytes / 1024.0**2).round} MB"
puts `df -h #{dir} | tail -1`.split.values_at(1, 3).then { |size, free| "disk /shared: size #{size}, free #{free}" }
puts "saved #{dir}/#{label}.txt"
