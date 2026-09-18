package web

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

type geoJSONFeatureCollection struct {
	Type     string           `json:"type"`
	Features []geoJSONFeature `json:"features"`
}

type geoJSONFeature struct {
	Type       string            `json:"type"`
	Geometry   geoJSONPoint      `json:"geometry"`
	Properties map[string]string `json:"properties"`
}

type geoJSONPoint struct {
	Type        string    `json:"type"`
	Coordinates []float64 `json:"coordinates"`
}

func (s *Server) exportJob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, methodNotAllowedMessage, http.StatusMethodNotAllowed)
		return
	}

	id, ok := getIDFromRequest(r)
	if !ok {
		http.Error(w, "Invalid ID", http.StatusUnprocessableEntity)
		return
	}

	format := r.URL.Query().Get("format")
	if format == "" || format == "csv" {
		s.download(w, r)
		return
	}

	path, err := s.svc.GetCSV(r.Context(), id.String())
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	records, err := readCSVAsMaps(path)
	if err != nil {
		http.Error(w, "failed to read job output", http.StatusInternalServerError)
		return
	}

	switch format {
	case "json":
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.json", id.String()))
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(records)
	case "geojson":
		fc := recordsToGeoJSON(records)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.geojson", id.String()))
		w.Header().Set("Content-Type", "application/geo+json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(fc)
	default:
		http.Error(w, "format must be csv, json or geojson", http.StatusUnprocessableEntity)
	}
}

func readCSVAsMaps(path string) ([]map[string]string, error) {
	f, err := os.Open(filepath.Clean(path)) //nolint:gosec // path comes from Service.GetCSV and is rooted in the configured data folder.
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = f.Close()
	}()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1

	headers, err := r.Read()
	if err != nil {
		if err == io.EOF {
			return []map[string]string{}, nil
		}
		return nil, err
	}

	out := make([]map[string]string, 0)
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		item := make(map[string]string, len(headers))
		for i, name := range headers {
			if i < len(row) {
				item[name] = row[i]
			} else {
				item[name] = ""
			}
		}
		out = append(out, item)
	}

	return out, nil
}

func recordsToGeoJSON(records []map[string]string) geoJSONFeatureCollection {
	fc := geoJSONFeatureCollection{
		Type:     "FeatureCollection",
		Features: make([]geoJSONFeature, 0, len(records)),
	}

	for _, record := range records {
		lat, errLat := strconv.ParseFloat(record["latitude"], 64)
		lon, errLon := strconv.ParseFloat(record["longitude"], 64)
		if errLat != nil || errLon != nil || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
			continue
		}

		props := make(map[string]string, len(record))
		for k, v := range record {
			if k == "latitude" || k == "longitude" {
				continue
			}
			props[k] = v
		}

		fc.Features = append(fc.Features, geoJSONFeature{
			Type: "Feature",
			Geometry: geoJSONPoint{
				Type:        "Point",
				Coordinates: []float64{lon, lat},
			},
			Properties: props,
		})
	}

	return fc
}
