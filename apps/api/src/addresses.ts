import { BlockList, isIP } from 'node:net';

/** Whether an address falls in one of the configured IP addresses or CIDR ranges. */
export type AddressMatcher = (address: string) => boolean;

const FAMILIES = { 4: { name: 'ipv4', bits: 32 }, 6: { name: 'ipv6', bits: 128 } } as const;

function familyOf(address: string) {
  const version = isIP(address);
  return version === 4 || version === 6 ? FAMILIES[version] : undefined;
}

/** Bits of a CIDR prefix, the whole address without one, or none when it is not a number. */
function prefixBits(prefix: string | undefined, addressBits: number): number | undefined {
  if (prefix === undefined) return addressBits;
  return /^\d+$/.test(prefix) ? Number(prefix) : undefined;
}

/**
 * Returns whether an address falls in a comma-separated list of IP addresses and CIDR ranges,
 * read from the environment variable named `variable`. An IPv4 range also matches IPv4
 * addresses mapped to IPv6.
 */
export function parseAddressRanges(list: string, variable: string): AddressMatcher {
  const ranges = new BlockList();
  for (const entry of list.split(',').map((part) => part.trim())) {
    if (!entry) continue;
    const [address = '', prefix, ...rest] = entry.split('/');
    const addressFamily = familyOf(address);
    const bits = addressFamily && prefixBits(prefix, addressFamily.bits);
    if (!addressFamily || bits === undefined || bits > addressFamily.bits || rest.length > 0) {
      throw new RangeError(`${variable} must list IP addresses or CIDR ranges, separated by commas`);
    }
    ranges.addSubnet(address, bits, addressFamily.name);
  }
  return (address) => {
    const addressFamily = familyOf(address);
    return addressFamily !== undefined && ranges.check(address, addressFamily.name);
  };
}

/**
 * Returns the client's address. A trusted reverse proxy appends the address it sees to
 * `X-Forwarded-For`: earlier entries come from the client and can be forged. From any other
 * connection, the whole header can be forged (#91), so the connection's own address counts.
 */
export function clientAddress(
  connection: string,
  forwardedFor: string | undefined,
  trustedProxies: AddressMatcher,
): string {
  if (!trustedProxies(connection)) return connection;
  return forwardedFor?.split(',').at(-1)?.trim() || connection;
}
