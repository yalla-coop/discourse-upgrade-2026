// Preload for Prose only: sends one host name to another IP, so Prose can reach
// the clone as app.forwardtrust.org.uk without changing the Mac's /etc/hosts.
//   NODE_OPTIONS="--require /path/dns-override.cjs" DNS_OVERRIDE="app.forwardtrust.org.uk=1.2.3.4"
const dns = require('node:dns');
const [host, ip] = (process.env.DNS_OVERRIDE || '').split('=');
if (host && ip) {
  const lookup = dns.lookup;
  dns.lookup = function (name, options, callback) {
    if (name !== host) return lookup.apply(this, arguments);
    const cb = typeof options === 'function' ? options : callback;
    const all = typeof options === 'object' && options && options.all;
    process.nextTick(() => (all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)));
  };
}
