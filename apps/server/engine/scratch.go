package engine

import (
	"os"
	"path/filepath"
	"time"
)

// StaleScratch is how old a scratch directory is when its build is taken for dead: a build killed by the system (out of
// memory) cannot remove its own, and the directory is as big as the graph. A build takes hours, not a day.
const StaleScratch = 24 * time.Hour

// SweepScratch removes the directories below tmp named like pattern that nothing has touched for StaleScratch.
func SweepScratch(tmp, pattern string) {
	old, _ := filepath.Glob(filepath.Join(tmp, pattern))
	for _, dir := range old {
		if info, err := os.Stat(dir); err == nil && info.IsDir() && quietSince(dir, info.ModTime()) {
			os.RemoveAll(dir)
		}
	}
}

// quietSince tells whether nothing in dir changed for StaleScratch. The directory's own time moves only when a file is
// created or removed in it, not when one is written to: a live build in a long step keeps writing to its files. Whatever
// cannot be read counts as changed, so that a doubt never costs a build its files.
func quietSince(dir string, modTime time.Time) bool {
	if time.Since(modTime) <= StaleScratch {
		return false
	}
	list, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range list {
		if info, err := e.Info(); err != nil || time.Since(info.ModTime()) <= StaleScratch {
			return false
		}
	}
	return true
}
