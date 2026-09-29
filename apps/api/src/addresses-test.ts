import { parseAddressRanges } from './addresses.ts';

describe('parseAddressRanges', () => {
  it.each([
    ['an IPv4 address', '172.18.0.3', '172.18.0.3'],
    ['an IPv4 range', '172.18.0.0/16', '172.18.200.7'],
    ['an IPv6 address', '::1', '::1'],
    ['an IPv6 range', '2001:db8::/32', '2001:db8:0:1::1'],
    ['an IPv4 range, for an IPv4 address mapped to IPv6', '172.18.0.0/16', '::ffff:172.18.0.3'],
    ['the second entry of a list', '10.0.0.1, 172.18.0.0/16', '172.18.0.3'],
    ['any IPv4 address for every range', '0.0.0.0/0, ::/0', '203.0.113.1'],
    ['any IPv6 address for every range', '0.0.0.0/0, ::/0', '2001:db8::1'],
    ['any IPv4 address mapped to IPv6 for every range', '0.0.0.0/0, ::/0', '::ffff:203.0.113.1'],
  ])('matches %s', (_, list, address) => {
    const inRanges = parseAddressRanges(list, 'TRUSTED_PROXIES');

    expect(inRanges(address)).toBe(true);
  });

  it.each([
    ['an address outside the ranges', '172.18.0.0/16', '172.19.0.1'],
    ['an IPv6 address for an IPv4 range', '172.18.0.0/16', '2001:db8::1'],
    ['an empty address, when the connection has none', '172.18.0.0/16', ''],
    ['anything for an empty list', '', '127.0.0.1'],
    ['an empty address for every range', '0.0.0.0/0, ::/0', ''],
  ])('does not match %s', (_, list, address) => {
    const inRanges = parseAddressRanges(list, 'TRUSTED_PROXIES');

    expect(inRanges(address)).toBe(false);
  });

  it('ignores empty entries, such as after a trailing comma', () => {
    const inRanges = parseAddressRanges('172.18.0.3,', 'TRUSTED_PROXIES');

    expect(inRanges('172.18.0.3')).toBe(true);
  });

  it.each([
    ['a host name', 'caddy'],
    ['an IPv4 prefix beyond 32', '172.18.0.0/33'],
    ['an IPv6 prefix beyond 128', '::/129'],
    ['a prefix that is not a number', '172.18.0.0/x'],
    ['a negative prefix', '172.18.0.0/-1'],
    ['an empty address before the prefix', '/16'],
    ['an empty prefix', '172.18.0.0/'],
    ['two prefixes', '172.18.0.0/16/8'],
    ['a wildcard', '*'],
  ])('rejects %s, naming the variable but not the value', (_, list) => {
    expect(() => parseAddressRanges(`10.0.0.1, ${list}`, 'TRUSTED_PROXIES')).toThrow(
      new RangeError('TRUSTED_PROXIES must list IP addresses or CIDR ranges, separated by commas'),
    );
  });
});
