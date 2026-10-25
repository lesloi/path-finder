package graphbuild

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/lesloi/path-finder/apps/server/contract"
)

func TestClassifyPOI(t *testing.T) {
	cases := []struct {
		name     string
		tags     [][2]string
		category string
		seasonal bool
	}{
		{"a drinking water amenity", [][2]string{{"amenity", "drinking_water"}}, "water", false},
		{"any object that says drinking_water=yes", [][2]string{{"amenity", "cafe"}, {"drinking_water", "yes"}}, "water", false},
		{"drinking_water=no on a drinking water amenity", [][2]string{{"amenity", "drinking_water"}, {"drinking_water", "no"}}, "", false},
		{"drinking_water=no alone", [][2]string{{"drinking_water", "no"}}, "", false},
		{"a seasonal water point", [][2]string{{"amenity", "drinking_water"}, {"seasonal", "summer"}}, "water", true},
		{"seasonal=yes", [][2]string{{"amenity", "drinking_water"}, {"seasonal", "yes"}}, "water", true},
		{"seasonal=no is not seasonal", [][2]string{{"amenity", "drinking_water"}, {"seasonal", "no"}}, "water", false},
		{"a viewpoint", [][2]string{{"tourism", "viewpoint"}}, "viewpoint", false},
		{"a bench", [][2]string{{"amenity", "bench"}}, "", false},
		{"toilets", [][2]string{{"amenity", "toilets"}}, "toilets", false},
		{"fee-paying toilets", [][2]string{{"amenity", "toilets"}, {"fee", "yes"}}, "toilets", false},
		{"toilets with drinking_water=no", [][2]string{{"amenity", "toilets"}, {"drinking_water", "no"}}, "toilets", false},
		{"private toilets", [][2]string{{"amenity", "toilets"}, {"access", "private"}}, "", false},
		{"toilets for customers", [][2]string{{"amenity", "toilets"}, {"access", "customers"}}, "", false},
		{"toilets with access=no", [][2]string{{"amenity", "toilets"}, {"access", "no"}}, "", false},
		{"permissive toilets", [][2]string{{"amenity", "toilets"}, {"access", "permissive"}}, "toilets", false},
		{"a viewpoint with drinking_water=no", [][2]string{{"tourism", "viewpoint"}, {"drinking_water", "no"}}, "viewpoint", false},
		{"a shelter", [][2]string{{"amenity", "shelter"}}, "", false},
		{"an alpine hut", [][2]string{{"tourism", "alpine_hut"}}, "", false},
		{"a wilderness hut", [][2]string{{"tourism", "wilderness_hut"}}, "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var kv []string
			for _, tag := range c.tags {
				kv = append(kv, tag[0], tag[1])
			}

			category, seasonal := classifyPOI(tags(kv...))

			if category != c.category || seasonal != c.seasonal {
				t.Errorf("classifyPOI = %q, %v; want %q, %v", category, seasonal, c.category, c.seasonal)
			}
		})
	}
}

func TestClassifyPOIPutsSeasonalityOnWaterOnly(t *testing.T) {
	for _, kv := range [][]string{{"tourism", "viewpoint"}, {"amenity", "toilets"}} {
		_, seasonal := classifyPOI(tags(append(kv, "seasonal", "summer")...))

		if seasonal {
			t.Errorf("%v is flagged seasonal", kv)
		}
	}
}

func readTile(t *testing.T, dir string, x, y int) contract.POITile {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, strconv.Itoa(x), strconv.Itoa(y)+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var tile contract.POITile
	if err := json.Unmarshal(data, &tile); err != nil {
		t.Fatal(err)
	}
	return tile
}

func TestBuildPOIsWritesOneFilePerTileThatHoldsPOIs(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "pois")
	// Two points of Paris, one of Grenoble, and a way of water around a square in Lyon.
	nodes := []pbfNode{
		{1, 48.8566, 2.3522}, {2, 48.8570, 2.3530}, {3, 45.1885, 5.7245}, {4, 45.0, 5.0},
		{10, 45.7600, 4.8400}, {11, 45.7600, 4.8420}, {12, 45.7620, 4.8420}, {13, 45.7620, 4.8400},
	}
	nodeTags := map[int64][][2]string{
		1: {{"amenity", "drinking_water"}, {"seasonal", "summer"}},
		2: {{"tourism", "viewpoint"}, {"name", "Tour Eiffel"}},
		3: {{"amenity", "drinking_water"}, {"drinking_water", "no"}}, // left out
		4: {{"amenity", "bench"}},                                    // not a POI
	}
	ways := []pbfWay{{id: 20, refs: []int64{10, 11, 12, 13, 10}, tags: [][2]string{{"amenity", "fountain"}, {"drinking_water", "yes"}, {"name", "Fontaine Bellecour"}}}}
	pbf := filepath.Join(dir, "a.pbf")
	writeTaggedPBF(t, pbf, nodes, nodeTags, ways)

	var log bytes.Buffer
	err := BuildPOIs([]string{pbf}, out, &log)

	if err != nil {
		t.Fatal(err)
	}
	px, py := contract.POITileOf(48.8566, 2.3522)
	paris := readTile(t, out, px, py)
	want := []contract.POI{
		{Category: "water", Position: [2]float64{2.3522, 48.8566}, Seasonal: true},
		{Category: "viewpoint", Position: [2]float64{2.353, 48.857}, Name: "Tour Eiffel"},
	}
	if len(paris.POIs) != 2 || paris.POIs[0] != want[0] || paris.POIs[1] != want[1] {
		t.Errorf("Paris tile = %+v, want %+v", paris.POIs, want)
	}
	lx, ly := contract.POITileOf(45.761, 4.841)
	lyon := readTile(t, out, lx, ly)
	if len(lyon.POIs) != 1 || lyon.POIs[0].Category != "water" || lyon.POIs[0].Position != [2]float64{4.841, 45.761} || lyon.POIs[0].Name != "Fontaine Bellecour" {
		t.Errorf("Lyon tile = %+v, want the centroid of the named way", lyon.POIs)
	}
	var files int
	_ = filepath.Walk(out, func(_ string, info os.FileInfo, _ error) error {
		if info != nil && !info.IsDir() {
			files++
		}
		return nil
	})
	if files != 2 {
		t.Errorf("%d tile files, want 2: a tile without POIs is not written", files)
	}
	if !strings.Contains(log.String(), "3 points of interest") {
		t.Errorf("progress lacks the count:\n%s", log.String())
	}
}

func TestBuildPOIsCountsAnObjectOnceWhenFilesOverlap(t *testing.T) {
	dir := t.TempDir()
	nodes := []pbfNode{{1, 48.8566, 2.3522}}
	tagsOf := map[int64][][2]string{1: {{"amenity", "drinking_water"}}}
	a, b := filepath.Join(dir, "a.pbf"), filepath.Join(dir, "b.pbf")
	writeTaggedPBF(t, a, nodes, tagsOf, nil)
	writeTaggedPBF(t, b, nodes, tagsOf, nil)
	out := filepath.Join(dir, "pois")

	if err := BuildPOIs([]string{a, b}, out, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}

	x, y := contract.POITileOf(48.8566, 2.3522)
	if got := len(readTile(t, out, x, y).POIs); got != 1 {
		t.Errorf("%d POIs, want 1", got)
	}
}

func TestBuildPOIsRefusesADirectoryThatIsNotEmpty(t *testing.T) {
	dir := t.TempDir()
	pbf := filepath.Join(dir, "a.pbf")
	writeTaggedPBF(t, pbf, []pbfNode{{1, 48.8, 2.3}}, nil, nil)
	out := filepath.Join(dir, "pois")
	if err := os.MkdirAll(out, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(out, "old"), nil, 0o644); err != nil {
		t.Fatal(err)
	}

	err := BuildPOIs([]string{pbf}, out, &bytes.Buffer{})

	if err == nil {
		t.Error("err = nil: tiles must not be mixed with a previous build")
	}
}
