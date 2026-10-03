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
	if _, err := standin.Write(os.Args[1]); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("DATA_DIR=%s\n", os.Args[1])
}
