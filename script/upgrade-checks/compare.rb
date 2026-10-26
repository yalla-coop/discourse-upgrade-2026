# Compares /shared/rehearsal/before.txt and after.txt. Names and numbers only.
#   ruby /shared/rehearsal/compare.rb
dir = ENV.fetch("REHEARSAL_DIR", "/shared/rehearsal")
read = ->(label) do
  File.readlines("#{dir}/#{label}.txt", chomp: true).group_by { |l| l.split.first }
end
before, after = read.("before"), read.("after")
kv = ->(rows) { (rows || []).to_h { |l| p = l.split; [p[1], p[2]] } }

puts "version: #{before["version"]&.first&.delete_prefix("version ")} -> #{after["version"]&.first&.delete_prefix("version ")}"
bc, ac = kv.(before["count"]), kv.(after["count"])
fewer = bc.select { |t, n| ac.key?(t) && ac[t].to_i < n.to_i }
puts "tables with FEWER rows after: #{fewer.empty? ? "none" : ""}"
fewer.each { |t, n| puts "  #{t}: #{n} -> #{ac[t]}" }
gone = bc.keys - ac.keys
puts "tables gone after: #{gone.empty? ? "none" : gone.join(", ")}"
%w[users topics posts uploads groups categories user_emails post_uploads upload_references].each do |t|
  puts "  #{t}: #{bc[t]} -> #{ac[t]}"
end
%w[upload_files upload_bytes].each { |k| puts "#{k}: #{before[k]&.first&.split&.last} -> #{after[k]&.first&.split&.last}" }
bs, as = kv.(before["setting"]), kv.(after["setting"])
changed = bs.select { |n, f| as.key?(n) && as[n] != f }.keys
puts "settings changed value: #{changed.empty? ? "none" : changed.join(", ")}"
puts "settings gone (renamed or default again): #{(bs.keys - as.keys).then { |x| x.empty? ? "none" : x.join(", ") }}"
puts "settings new: #{(as.keys - bs.keys).then { |x| x.empty? ? "none" : x.join(", ") }}"
bp, ap = (before["plugin"] || []).map { |l| l.split[1] }, (after["plugin"] || []).map { |l| l.split[1] }
puts "plugins gone: #{(bp - ap).then { |x| x.empty? ? "none" : x.join(", ") }} | plugins new: #{(ap - bp).then { |x| x.empty? ? "none" : x.join(", ") }}"
