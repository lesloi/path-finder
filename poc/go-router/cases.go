package main

type testCase struct {
	name       string
	flat, flon float64
	tlat, tlon float64
}

// Routes around Versailles, Saint-Germain-en-Laye, Rambouillet and the Chevreuse valley.
var yvelinesCases = []testCase{
	{"Versailles chateau -> Trianon", 48.8049, 2.1204, 48.8156, 2.1052},
	{"Versailles-Chantiers -> Saint-Cyr", 48.7955, 2.1356, 48.7993, 2.0734},
	{"Saint-Germain -> Maisons-Laffitte", 48.8975, 2.0946, 48.9473, 2.1456},
	{"Rambouillet -> etang St-Hubert", 48.6446, 1.8313, 48.6803, 1.9264},
	{"Chevreuse -> Dampierre", 48.7087, 2.0348, 48.7106, 1.9769},
	{"Marly -> Louveciennes (forest)", 48.8653, 2.0902, 48.8553, 2.1146},
}

// Mountain routes around Annecy, Grenoble, Chamonix and Chambery.
var alpsCases = []testCase{
	{"Annecy -> Talloires (lake)", 45.8992, 6.1294, 45.8383, 6.2145},
	{"Annecy-le-Vieux -> Cret de Chatillon", 45.9190, 6.1450, 45.7962, 6.1090},
	{"Grenoble -> Bastille", 45.1913, 5.7247, 45.2007, 5.7257},
	{"Chamonix -> Montenvers", 45.9237, 6.8694, 45.9317, 6.9208},
	{"Chambery -> Mont Revard", 45.5646, 5.9178, 45.6376, 5.9843},
	{"Annecy -> Mont Veyrier", 45.8992, 6.1294, 45.8745, 6.1795},
}

// Long routes between cities and valleys, 50 to 110 km.
var longCases = []testCase{
	{"Annecy -> Chamonix", 45.8992, 6.1294, 45.9237, 6.8694},
	{"Grenoble -> Chambery", 45.1913, 5.7247, 45.5646, 5.9178},
	{"Chambery -> Annecy", 45.5646, 5.9178, 45.8992, 6.1294},
	{"Lyon -> Saint-Etienne", 45.7640, 4.8357, 45.4397, 4.3872},
	{"Annecy -> Grenoble", 45.8992, 6.1294, 45.1913, 5.7247},
	{"Lyon -> Grenoble", 45.7640, 4.8357, 45.1913, 5.7247},
}

type loopCase struct {
	lat, lon        float64
	distKm, ascentM float64
}

var loopCases = []loopCase{
	{45.9190, 6.1450, 30, 1500},
	{45.1885, 5.7245, 50, 2000},
	{45.9237, 6.8694, 40, 2500},
	{45.5646, 5.9178, 60, 1500},
}
