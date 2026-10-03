package server

import (
	"fmt"
	"net/netip"
	"strings"
)

// ParseAddressRanges reads a comma-separated list of IP addresses and CIDR ranges, from the
// environment variable named variable. An IPv4 range also matches IPv4 addresses mapped to IPv6.
func ParseAddressRanges(list, variable string) ([]netip.Prefix, error) {
	var ranges []netip.Prefix
	for _, entry := range strings.Split(list, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(entry)
		if err != nil {
			addr, addrErr := netip.ParseAddr(entry)
			if addrErr != nil {
				return nil, fmt.Errorf("%s must list IP addresses or CIDR ranges, separated by commas", variable)
			}
			prefix = netip.PrefixFrom(addr, addr.BitLen())
		}
		ranges = append(ranges, prefix)
	}
	return ranges, nil
}

func inRanges(ranges []netip.Prefix, addr netip.Addr) bool {
	addr = addr.Unmap()
	for _, p := range ranges {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

var loopbacks = []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("::1/128")}

// rateKey is the address a rate limit counts: hosts usually get a whole IPv6 /64, so it counts as one.
func rateKey(address string) string {
	addr, err := netip.ParseAddr(address)
	if err != nil {
		return address
	}
	addr = addr.Unmap()
	if addr.Is6() {
		return netip.PrefixFrom(addr, 64).Masked().String()
	}
	return addr.String()
}
