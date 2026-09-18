//nolint:testpackage // tests internal export helpers and spatial JobData validation
package web

import (
	"testing"
)

func TestRecordsToGeoJSON(t *testing.T) {
	t.Parallel()

	records := []map[string]string{
		{
			"title":     "Cafe A",
			"latitude":  "10.2501",
			"longitude": "105.9702",
			"phone":     "0123456789",
		},
		{
			"title":     "Invalid",
			"latitude":  "not-a-number",
			"longitude": "105.0",
		},
	}

	fc := recordsToGeoJSON(records)
	if fc.Type != "FeatureCollection" {
		t.Fatalf("unexpected type: %s", fc.Type)
	}

	if len(fc.Features) != 1 {
		t.Fatalf("expected 1 feature, got %d", len(fc.Features))
	}

	got := fc.Features[0]
	if got.Geometry.Type != "Point" {
		t.Fatalf("unexpected geometry type: %s", got.Geometry.Type)
	}

	if len(got.Geometry.Coordinates) != 2 ||
		got.Geometry.Coordinates[0] != 105.9702 ||
		got.Geometry.Coordinates[1] != 10.2501 {
		t.Fatalf("unexpected coordinates: %#v", got.Geometry.Coordinates)
	}

	if got.Properties["title"] != "Cafe A" {
		t.Fatalf("unexpected properties: %#v", got.Properties)
	}

	if _, ok := got.Properties["latitude"]; ok {
		t.Fatal("latitude should be represented by geometry, not properties")
	}
}

func TestJobDataValidateSpatialCenters(t *testing.T) {
	t.Parallel()

	data := JobData{
		Keywords: []string{"coffee"},
		Lang:     "vi",
		Depth:    10,
		MaxTime:  180000000000,
		FastMode: true,
		Centers: []GeoPoint{
			{Lat: 10.25, Lon: 105.97},
		},
	}

	if err := data.Validate(); err != nil {
		t.Fatalf("expected valid spatial job, got %v", err)
	}

	data.Centers[0].Lat = 100
	if err := data.Validate(); err == nil {
		t.Fatal("expected invalid latitude error")
	}
}
