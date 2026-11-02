package engine

import "strconv"

// Mode is a travel mode: what the ways of the graph are open to, and which nodes, components and landmarks a search
// uses. It is not an activity: the same surface preferences serve every way of moving of a mode.
type Mode uint8

const (
	Foot Mode = iota
	Bike
	NumModes
)

// ModeNames are the travel modes of the contract, in the order of the constants.
var ModeNames = []string{"foot", "bike"}

func (m Mode) String() string {
	if int(m) < len(ModeNames) {
		return ModeNames[m]
	}
	return "mode(" + strconv.Itoa(int(m)) + ")"
}

// ParseMode reads a mode name, such as one of the contract.
func ParseMode(name string) (Mode, bool) {
	for i, n := range ModeNames {
		if n == name {
			return Mode(i), true
		}
	}
	return 0, false
}

// Bit is the bit of the mode in an edge's Modes or in a node mode bitmap.
func (m Mode) Bit() uint8 { return 1 << m }
