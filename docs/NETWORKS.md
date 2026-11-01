# Using several networks

[Bahasa Indonesia](id/NETWORKS.md)

ZIVAR can split one download across every network your computer is connected to, for example Wi-Fi plus a phone's
USB tethering, so the speeds add up. The idea comes from the open-source app [Plexo](https://github.com/anmolkapil/plexo).

## When it helps

It helps only when each network has **its own way to the internet**.

| Setup | Faster? |
| --- | --- |
| Home Wi-Fi + a phone tethered over USB or Wi-Fi hotspot | Yes: two separate connections |
| Two ISPs on two adapters | Yes |
| Wi-Fi and Ethernet from the **same router** | No: both share one connection |
| A VPN adapter next to your normal one | Usually no |

## Turning it on

- **Settings → Networks → Combine my networks to download faster**, then tick the networks to use. Virtual adapters
  (Hyper-V, WSL, Docker, VPN tunnels and so on) are listed but not ticked.
- Or per download: when two or more networks are connected, the browser extension's download window shows
  **Use all my networks**, which applies to that download only.

It is off by default.

## What ZIVAR does

1. Each connection of a download is bound to the IP address of one network adapter, so the operating system sends it
   out through that adapter.
2. Before the download starts, every network is **tested against the real server**. A network that cannot reach it is
   left out for this download, so a broken adapter cannot stall it.
3. The file is cut into small chunks (2 MB and up). Every connection of every network takes the next free chunk, so a fast
   network simply takes more of the file and a slow one never holds the rest back.
4. If a network drops out in the middle (a phone is unplugged), its chunks go to the other networks and the download
   carries on. If the last network fails, the download stops with the usual error and can be resumed.
5. While it runs, the **Description** column shows each network's speed, for example `Wi-Fi 2 3.4 MB/s · Ethernet 1.1 MB/s`.

## Limits

- Needs a server that supports resuming (byte ranges) and a file of at least 4 MB. Otherwise the normal path is used.
- Not used while a proxy is set, and not used for YouTube and video-stream downloads.
- **Windows and macOS** choose the outgoing adapter from the source address, which is what ZIVAR binds. **Linux** may
  need extra routing (per-adapter rules) before a second network can carry traffic; the test in step 2 leaves such a
  network out instead of failing.
- If a second network does not add speed, check the per-network speeds: when both go out through the same physical
  link the total stays the same.
- Chunks are flushed to disk together with the finished file rather than one by one, because on some systems a disk
  flush takes hundreds of milliseconds and would stall every network at once.
