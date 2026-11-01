// Using several internet connections for one download.
//
// Each connection of a download is bound to the IP address of one network adapter (`localAddress`),
// so the operating system sends it out through that adapter. Windows and macOS choose the outgoing
// adapter from the source address; Linux only does so with extra routing set up, which is why a network
// is always tested against the real server before it is used (see DownloadManager.verifiedNetworks).
// The idea of balancing chunks across adapters comes from the open-source app Plexo.
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';

// Adapters that only exist inside this computer (virtual machines, containers, VPN tunnels). They are
// listed, but not used unless the user selects them.
const VIRTUAL_NAME = /vethernet|hyper-v|wsl|docker|vmware|vmnet|virtualbox|vboxnet|veth|virbr|\bbr-|bridge|tailscale|zerotier|npcap|wireguard|warp|\btun\d|\btap\d|utun|awdl|llw|anpi|pseudo/i;
const VIRTUAL_MAC = /^(00:15:5d|00:50:56|00:0c:29|08:00:27|02:42)/i;

function kindOf(name) {
  if (/wi-?fi|wlan|wireless|^wl/i.test(name)) return 'wifi';
  if (/rndis|tether|usb|iphone|android|mobile|cellular|wwan/i.test(name)) return 'mobile';
  if (/ethernet|^en\d|^eth|^lan/i.test(name)) return 'ethernet';
  return 'other';
}

/** The networks this computer is connected to: one entry per adapter that has a usable address. */
export function listNetworks({ interfaces = os.networkInterfaces() } = {}) {
  const networks = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    const usable = (addresses || []).filter(item => !item.internal && !item.address.startsWith('169.254.') && !item.address.toLowerCase().startsWith('fe80:'));
    const family = item => (item.family === 'IPv6' || item.family === 6) ? 6 : 4;
    const chosen = usable.find(item => family(item) === 4) || usable[0];
    if (!chosen) continue;
    networks.push({
      id: name, name, address: chosen.address, family: family(chosen), kind: kindOf(name),
      virtual: VIRTUAL_NAME.test(name) || VIRTUAL_MAC.test(chosen.mac || ''),
    });
  }
  return networks.sort((a, b) => Number(a.virtual) - Number(b.virtual) || a.name.localeCompare(b.name));
}

/** The networks a download may use: the ones the user ticked, or every real (non-virtual) one. */
export function selectNetworks(networks, selection) {
  return Array.isArray(selection) ? networks.filter(network => selection.includes(network.id)) : networks.filter(network => !network.virtual);
}

export function normalizeNetworkSelection(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(item => String(item).trim()).filter(item => item && item.length <= 128))].slice(0, 32);
}

const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNABORTED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'EADDRNOTAVAIL', 'EPIPE', 'EAI_AGAIN', 'ERR_SOCKET_CONNECTION_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
/** Whether an error says something about the network (it dropped, went silent, vanished) rather than
 * the server answering wrongly. A download keeps going on its other networks when one of these happens. */
export function isNetworkFailure(error) {
  if (error?.network) return true;
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) if (NETWORK_CODES.has(current.code)) return true;
  return false;
}

/** One GET request that leaves through `network`. It returns the same shape the engine reads from
 * fetch(): status, headers.get(name) and an async-iterable body with cancel(). */
export function requestVia(network, url, { headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(target, {
      method: 'GET', agent: false, signal, localAddress: network.address, family: network.family,
      headers: { 'user-agent': 'ZIVAR-Download-Manager', ...headers },
    }, response => {
      resolve({
        status: response.statusCode,
        headers: { get: name => { const value = response.headers[String(name).toLowerCase()]; return Array.isArray(value) ? value.join(', ') : value ?? null; } },
        body: { [Symbol.asyncIterator]: () => response[Symbol.asyncIterator](), cancel: async () => { response.destroy(); } },
      });
    });
    // An abort carries its own reason (for example the 45-second silence timeout); report that.
    request.once('error', error => reject(signal?.aborted && signal.reason ? signal.reason : error));
    request.end();
  });
}
