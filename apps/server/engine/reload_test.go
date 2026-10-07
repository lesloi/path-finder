package engine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// reloadProfiles are the profiles of the tests: writeZone writes the landmarks of each.
var reloadProfiles = ProfileNames

// filesPerZone is what a zone of the tests maps: its graph, and the landmarks of each profile.
var filesPerZone = int64(1 + len(ProfileNames))

// renameOver renames files from one directory over the same names in another, as a deployment does.
func renameOver(t *testing.T, from, to string, names ...string) {
	t.Helper()
	for _, name := range names {
		if err := os.Rename(filepath.Join(from, name), filepath.Join(to, name)); err != nil {
			t.Fatal(err)
		}
	}
}

// deployLandmarks renames the landmarks of the zone written in aside over those of dir.
func deployLandmarks(t *testing.T, aside, dir string) {
	t.Helper()
	for _, profile := range reloadProfiles {
		renameOver(t, aside, dir, LandmarksFileName(profile))
	}
}

// deployGraphOnly renames the graph of g over the one of dir and leaves its landmarks in the directory it
// returns: the zone is half deployed, with a graph that its landmarks were not built for.
func deployGraphOnly(t *testing.T, dir string, g *testGraph) (aside string) {
	t.Helper()
	aside = t.TempDir()
	writeZone(t, aside, g)
	renameOver(t, aside, dir, GraphFileName)
	return aside
}

// replaceZone swaps the files of a zone for those of g: the landmarks first, then the graph, so that the zone
// is whole again once it is done.
func replaceZone(t *testing.T, dir string, g *testGraph) {
	t.Helper()
	aside := t.TempDir()
	writeZone(t, aside, g)
	deployLandmarks(t, aside, dir)
	renameOver(t, aside, dir, GraphFileName)
}

// wantMapped checks how many files are mapped since base.
func wantMapped(t *testing.T, base, want int64) {
	t.Helper()
	if got := openMappings.Load() - base; got != want {
		t.Errorf("%d files mapped, want %d", got, want)
	}
}

func newReloader(t *testing.T, dir string) *Reloader {
	t.Helper()
	r, err := NewReloader(dir, reloadProfiles...)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func reloaderLoops(r *Reloader, from Point, enough func([]*Route) bool) ([]*Route, error) {
	return r.Profile("any").Loops(context.Background(), LoopRequest{Start: from, Distance: 3000, Candidates: 8, Seed: 3, Enough: enough})
}

func TestReloadDoesNothingWhileTheFilesAreTheSame(t *testing.T) {
	dir := t.TempDir()
	g, centre := zoneGraph(0, 0)
	writeZone(t, dir, g)
	base := openMappings.Load()
	r := newReloader(t, dir)
	if swapped, err := r.Reload(); swapped || err != nil {
		t.Errorf("swapped = %v, err = %v with nothing changed", swapped, err)
	}
	wantMapped(t, base, filesPerZone)
	if loops, err := reloaderLoops(r, centre, nil); err != nil || len(loops) == 0 {
		t.Errorf("loops: %d, %v", len(loops), err)
	}
}

func TestReloadServesTheReplacingFilesAndLetsGoOfTheReplacedOnes(t *testing.T) {
	dir := t.TempDir()
	old, oldCentre := zoneGraph(0, 0)
	writeZone(t, dir, old)
	base := openMappings.Load()
	r := newReloader(t, dir)

	next, nextCentre := zoneGraph(10_000, 0)
	if _, err := reloaderLoops(r, nextCentre, nil); err == nil {
		t.Fatal("the area of the new graph is served before it is there")
	}
	replaceZone(t, dir, next)
	swapped, err := r.Reload()
	if !swapped || err != nil {
		t.Fatalf("swapped = %v, err = %v after the files were replaced", swapped, err)
	}
	if loops, err := reloaderLoops(r, nextCentre, nil); err != nil || len(loops) == 0 {
		t.Errorf("loops on the new graph: %d, %v", len(loops), err)
	}
	if _, err := reloaderLoops(r, oldCentre, nil); err == nil {
		t.Error("the area of the replaced graph is still served")
	}
	wantMapped(t, base, filesPerZone)
	if swapped, err := r.Reload(); swapped || err != nil {
		t.Errorf("second reload: swapped = %v, err = %v", swapped, err)
	}
}

// A search that began on the replaced files ends on them, and they are unmapped only then.
func TestASearchInFlightKeepsItsFilesUntilItEnds(t *testing.T) {
	dir := t.TempDir()
	old, oldCentre := zoneGraph(0, 0)
	writeZone(t, dir, old)
	base := openMappings.Load()
	r := newReloader(t, dir)

	inSearch, resume := make(chan struct{}), make(chan struct{})
	var once sync.Once
	done := make(chan error, 1)
	go func() {
		loops, err := reloaderLoops(r, oldCentre, func([]*Route) bool {
			once.Do(func() { close(inSearch) })
			<-resume
			return false
		})
		if err == nil && len(loops) == 0 {
			err = ErrNoLoop
		}
		done <- err
	}()
	<-inSearch

	next, _ := zoneGraph(10_000, 0)
	replaceZone(t, dir, next)
	if swapped, err := r.Reload(); !swapped || err != nil {
		t.Fatalf("swapped = %v, err = %v", swapped, err)
	}
	wantMapped(t, base, 2*filesPerZone)
	close(resume)
	if err := <-done; err != nil {
		t.Fatalf("the search cut by the swap: %v", err)
	}
	wantMapped(t, base, filesPerZone)
}

// A deployment that has renamed the graph and not yet the landmarks leaves the served zones as they are.
func TestAReloadOfAHalfDeployedZoneKeepsTheServedOne(t *testing.T) {
	dir := t.TempDir()
	old, oldCentre := zoneGraph(0, 0)
	writeZone(t, dir, old)
	base := openMappings.Load()
	r := newReloader(t, dir)

	next, nextCentre := zoneGraph(10_000, 0)
	aside := deployGraphOnly(t, dir, next)
	if swapped, err := r.Reload(); swapped || err == nil {
		t.Fatalf("swapped = %v, err = %v: a graph with the landmarks of another cannot be served", swapped, err)
	}
	if loops, err := reloaderLoops(r, oldCentre, nil); err != nil || len(loops) == 0 {
		t.Errorf("the served zone stopped answering: %d loops, %v", len(loops), err)
	}
	wantMapped(t, base, filesPerZone)

	deployLandmarks(t, aside, dir)
	if swapped, err := r.Reload(); !swapped || err != nil {
		t.Fatalf("swapped = %v, err = %v once the zone is whole", swapped, err)
	}
	if loops, err := reloaderLoops(r, nextCentre, nil); err != nil || len(loops) == 0 {
		t.Errorf("loops on the new graph: %d, %v", len(loops), err)
	}
}

func TestAReloadSeesAZoneAddedOrRemoved(t *testing.T) {
	dir := t.TempDir()
	west, _ := zoneGraph(0, 0)
	writeZone(t, filepath.Join(dir, "west"), west)
	r := newReloader(t, dir)
	if r.Len() != 1 {
		t.Fatalf("%d zones, want 1", r.Len())
	}
	east, eastCentre := zoneGraph(10_000, 0)
	writeZone(t, filepath.Join(dir, "east"), east)
	if swapped, err := r.Reload(); !swapped || err != nil || r.Len() != 2 {
		t.Fatalf("zone added: swapped = %v, err = %v, %d zones", swapped, err, r.Len())
	}
	if loops, err := reloaderLoops(r, eastCentre, nil); err != nil || len(loops) == 0 {
		t.Errorf("loops in the added zone: %d, %v", len(loops), err)
	}
	if err := os.RemoveAll(filepath.Join(dir, "east")); err != nil {
		t.Fatal(err)
	}
	if swapped, err := r.Reload(); !swapped || err != nil || r.Len() != 1 {
		t.Fatalf("zone removed: swapped = %v, err = %v, %d zones", swapped, err, r.Len())
	}
}

func TestAFlatZoneKeepsItsLandmarksOptional(t *testing.T) {
	dir := t.TempDir()
	g, centre := zoneGraph(0, 0)
	writeZone(t, dir, g)
	for _, profile := range reloadProfiles {
		if err := os.Remove(filepath.Join(dir, LandmarksFileName(profile))); err != nil {
			t.Fatal(err)
		}
	}
	r := newReloader(t, dir)
	if swapped, err := r.Reload(); swapped || err != nil {
		t.Errorf("swapped = %v, err = %v: the landmarks were never there", swapped, err)
	}
	if loops, err := reloaderLoops(r, centre, nil); err != nil || len(loops) == 0 {
		t.Errorf("loops without landmarks: %d, %v", len(loops), err)
	}
}

func TestAReloadWithTheGraphGoneKeepsTheServedZone(t *testing.T) {
	dir := t.TempDir()
	g, centre := zoneGraph(0, 0)
	writeZone(t, dir, g)
	r := newReloader(t, dir)
	if err := os.Remove(filepath.Join(dir, GraphFileName)); err != nil {
		t.Fatal(err)
	}
	if swapped, err := r.Reload(); swapped || err == nil {
		t.Errorf("swapped = %v, err = %v with no graph left", swapped, err)
	}
	if loops, err := reloaderLoops(r, centre, nil); err != nil || len(loops) == 0 {
		t.Errorf("loops: %d, %v", len(loops), err)
	}
}

func TestZonesAreLetGoOnceAndNeverHeldAgain(t *testing.T) {
	dir := t.TempDir()
	g, _ := zoneGraph(0, 0)
	writeZone(t, dir, g)
	base := openMappings.Load()
	z, err := OpenZones(dir, reloadProfiles...)
	if err != nil {
		t.Fatal(err)
	}
	if !z.acquire() {
		t.Fatal("zones just opened cannot be held")
	}
	z.release() // a search
	if got := openMappings.Load() - base; got != filesPerZone {
		t.Fatalf("%d files mapped, want %d", got, filesPerZone)
	}
	z.release() // the hold of being current
	wantMapped(t, base, 0)
	if z.acquire() {
		t.Error("zones let go can be held again")
	}
	z.close() // a second unmap must not touch what is mapped since
	wantMapped(t, base, 0)
}

func TestOpenZonesLetsGoOfWhatItMappedWhenAZoneFails(t *testing.T) {
	dir := t.TempDir()
	g, _ := zoneGraph(0, 0)
	writeZone(t, filepath.Join(dir, "a"), g)
	writeZone(t, filepath.Join(dir, "b"), g)
	if err := os.Remove(filepath.Join(dir, "b", LandmarksFileName("paved"))); err != nil {
		t.Fatal(err)
	}
	base := openMappings.Load()
	if _, err := OpenZones(dir, reloadProfiles...); err == nil {
		t.Fatal("a zone without the landmarks of a profile opens")
	}
	wantMapped(t, base, 0)
}

// Searches run while the files are replaced again and again; the race detector and the faults of a mapping
// let go too early are what this looks for.
func TestSearchesWhileTheFilesAreReplacedAgainAndAgain(t *testing.T) {
	dir := t.TempDir()
	first, centre := zoneGraph(0, 0)
	writeZone(t, dir, first)
	base := openMappings.Load()
	r := newReloader(t, dir)

	stop := make(chan struct{})
	var wg sync.WaitGroup
	var searches, failures atomic.Int64
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				// Every graph is the same lattice, so every search must find loops, on either version.
				loops, err := reloaderLoops(r, centre, nil)
				searches.Add(1)
				if err != nil || len(loops) == 0 {
					failures.Add(1)
				}
			}
		}()
	}
	for range 10 {
		next, _ := zoneGraph(0, 0)
		replaceZone(t, dir, next)
		time.Sleep(time.Millisecond) // a different time from the file before
		for {
			if _, err := r.Reload(); err == nil {
				break
			}
			time.Sleep(time.Millisecond) // another look settles it
		}
	}
	close(stop)
	wg.Wait()
	if failures.Load() > 0 {
		t.Errorf("%d of %d searches failed during the swaps", failures.Load(), searches.Load())
	}
	wantMapped(t, base, filesPerZone)
}

// A search stopped early, by Enough or by its context, has ended its workers when it returns: the swap that
// follows may unmap what they read.
func TestASearchStoppedEarlyLeavesNothingReadingTheReplacedFiles(t *testing.T) {
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	stops := map[string]struct {
		ctx    context.Context
		enough func([]*Route) bool
	}{
		"enough":    {context.Background(), func([]*Route) bool { return true }},
		"cancelled": {cancelled, nil},
	}
	for name, stop := range stops {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			old, centre := zoneGraph(0, 0)
			writeZone(t, dir, old)
			base := openMappings.Load()
			r := newReloader(t, dir)
			_, _ = r.Profile("any").Loops(stop.ctx, LoopRequest{Start: centre, Distance: 3000, Candidates: 64, Seed: 3, Enough: stop.enough})

			next, _ := zoneGraph(0, 0)
			replaceZone(t, dir, next)
			if swapped, err := r.Reload(); !swapped || err != nil {
				t.Fatalf("swapped = %v, err = %v", swapped, err)
			}
			wantMapped(t, base, filesPerZone)
		})
	}
}

func TestAFailedReloadIsNotOpenedAgainForTheSameFiles(t *testing.T) {
	dir := t.TempDir()
	old, _ := zoneGraph(0, 0)
	writeZone(t, dir, old)
	r := newReloader(t, dir)
	next, _ := zoneGraph(10_000, 0)
	deployGraphOnly(t, dir, next)
	_, first := r.Reload()
	if first == nil {
		t.Fatal("a graph with the landmarks of another was served")
	}
	opens := zoneOpens.Load()
	// A second look at the same files fails the same way, and opens nothing.
	for range 3 {
		if _, err := r.Reload(); err == nil || err.Error() != first.Error() {
			t.Fatalf("err = %v, want the same as before: %v", err, first)
		}
	}
	if got := zoneOpens.Load() - opens; got != 0 {
		t.Errorf("the same failing files were opened %d more times", got)
	}
}

func TestWatchReloadsAndSaysAFailureOnce(t *testing.T) {
	dir := t.TempDir()
	old, _ := zoneGraph(0, 0)
	writeZone(t, dir, old)
	r := newReloader(t, dir)

	var mu sync.Mutex
	var lines []string
	logf := func(format string, args ...any) {
		mu.Lock()
		defer mu.Unlock()
		lines = append(lines, fmt.Sprintf(format, args...))
	}
	count := func(part string) (n int) {
		mu.Lock()
		defer mu.Unlock()
		for _, l := range lines {
			if strings.Contains(l, part) {
				n++
			}
		}
		return n
	}
	waitFor := func(part string, want int) {
		t.Helper()
		for range 500 {
			if count(part) >= want {
				return
			}
			time.Sleep(2 * time.Millisecond)
		}
		t.Fatalf("%q said %d times, want %d: %q", part, count(part), want, lines)
	}

	ctx, stop := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { r.Watch(ctx, 2*time.Millisecond, logf); close(done) }()
	defer func() { stop(); <-done }()

	next, _ := zoneGraph(10_000, 0)
	aside := deployGraphOnly(t, dir, next)
	waitFor("did not reload", 1)
	time.Sleep(30 * time.Millisecond) // many looks at the same failing files
	if n := count("did not reload"); n != 1 {
		t.Errorf("the failure was said %d times, want once", n)
	}
	deployLandmarks(t, aside, dir)
	waitFor("reloaded", 1)
}

// A failure of the system, not of the files, is tried again at the next look even though the files are the same.
func TestAReloadThatFailsOnTheSystemIsTriedAgain(t *testing.T) {
	dir := t.TempDir()
	old, _ := zoneGraph(0, 0)
	writeZone(t, dir, old)
	r := newReloader(t, dir)

	// A directory cannot be mapped: the open fails in the system call, whatever the files hold.
	if err := os.Remove(filepath.Join(dir, GraphFileName)); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, GraphFileName), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reload(); err == nil {
		t.Fatal("a directory in place of the graph was served")
	}
	opens := zoneOpens.Load()
	if _, err := r.Reload(); err == nil {
		t.Fatal("a directory in place of the graph was served")
	}
	if zoneOpens.Load() == opens {
		t.Error("the files that failed in the system were not opened again")
	}

	next, centre := zoneGraph(10_000, 0)
	if err := os.Remove(filepath.Join(dir, GraphFileName)); err != nil {
		t.Fatal(err)
	}
	replaceZone(t, dir, next)
	if swapped, err := r.Reload(); !swapped || err != nil {
		t.Fatalf("swapped = %v, err = %v once the graph is there", swapped, err)
	}
	if loops, err := reloaderLoops(r, centre, nil); err != nil || len(loops) == 0 {
		t.Errorf("loops on the new graph: %d, %v", len(loops), err)
	}
}

// noSys is a file version with nothing of the system in it.
type noSys struct{ os.FileInfo }

func (noSys) Sys() any { return nil }

func TestAFileVersionWithoutSystemDataIsTheSizeAndTime(t *testing.T) {
	st, err := os.Stat(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	got := fileIDOf(noSys{st})
	if got.dev != 0 || got.ino != 0 || got.size != st.Size() || got.mtimeNs != st.ModTime().UnixNano() {
		t.Errorf("version = %+v", got)
	}
}
