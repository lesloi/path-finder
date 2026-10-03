// Command standin writes the stand-in graph of the end-to-end tests into a directory and prints
// the environment that makes the server use it.
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/lesloi/path-finder/apps/server/internal/standin"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: standin <output directory>")
	}
	if err := os.MkdirAll(os.Args[1], 0o755); err != nil {
		log.Fatal(err)
	}
	f, err := standin.Write(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("GRAPH_FILE=%s\nLANDMARKS_HIKE=%s\nLANDMARKS_RUN=%s\n", f.Graph, f.LandmarksHike, f.LandmarksRun)
}
