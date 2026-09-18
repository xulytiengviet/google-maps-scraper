(function () {
    'use strict';

    var form = document.getElementById('spatial-search-form');
    if (!form || !window.L) return;

    var mode = 'text';
    var centers = [];
    var activeGeometry = null;
    var map = L.map('search-map', { zoomControl: true }).setView([16.2, 106.2], 6);
    var base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    var overlay = L.layerGroup().addTo(map);

    var summary = document.getElementById('spatial-summary');
    var centersInput = document.getElementById('centers');
    var geoModeInput = document.getElementById('geo_mode');
    var latInput = document.getElementById('latitude');
    var lonInput = document.getElementById('longitude');
    var radiusInput = document.getElementById('radius');
    var boundaryStatus = document.getElementById('boundary-status');

    function number(v) {
        var n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    function validPoint(p) {
        return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
            p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180;
    }

    function uniquePoints(points) {
        var seen = new Set();
        var out = [];
        points.forEach(function (p) {
            if (!validPoint(p)) return;
            var key = p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
            if (!seen.has(key)) {
                seen.add(key);
                out.push({ lat: p.lat, lon: p.lon });
            }
        });
        return out;
    }

    function capPoints(points, max) {
        if (points.length <= max) return points;
        var step = points.length / max;
        var out = [];
        for (var i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
        return out;
    }

    function setCenters(points, label) {
        centers = capPoints(uniquePoints(points), 250);
        centersInput.value = centers.length ? JSON.stringify(centers) : '';
        summary.textContent = label || (centers.length ? centers.length + ' điểm tìm kiếm' : 'Chưa chọn phạm vi không gian.');
        drawCenters();
    }

    function drawCenters() {
        overlay.clearLayers();
        if (activeGeometry) {
            L.geoJSON(activeGeometry, {
                style: { weight: 2, fillOpacity: 0.08 }
            }).addTo(overlay);
        }

        centers.forEach(function (p) {
            L.circleMarker([p.lat, p.lon], {
                radius: 4,
                weight: 1,
                fillOpacity: 0.75
            }).addTo(overlay);
        });

        var layers = overlay.getLayers();
        if (layers.length) {
            var group = L.featureGroup(layers);
            var bounds = group.getBounds();
            if (bounds && bounds.isValid()) map.fitBounds(bounds.pad(0.15));
        }
    }

    function setMode(nextMode) {
        mode = nextMode;
        geoModeInput.value = mode;
        document.querySelectorAll('.mode-tab').forEach(function (el) {
            el.classList.toggle('active', el.dataset.mode === mode);
        });
        document.querySelectorAll('.mode-panel').forEach(function (el) {
            el.classList.toggle('active', el.dataset.modePanel === mode);
        });
        if (mode === 'text') {
            activeGeometry = null;
            setCenters([], 'Tìm theo khu vực mô tả bằng chữ.');
        }
    }

    document.querySelectorAll('.mode-tab').forEach(function (tab) {
        tab.addEventListener('click', function () { setMode(tab.dataset.mode); });
    });

    function extractCoordinatePairs(text) {
        text = String(text || '').trim();
        var points = [];
        if (!text) return points;

        try {
            var obj = JSON.parse(text);
            var geometry = obj.type === 'Feature' ? obj.geometry : obj;
            if (geometry && geometry.type === 'Point') {
                points.push({ lat: Number(geometry.coordinates[1]), lon: Number(geometry.coordinates[0]) });
            } else if (geometry && geometry.type === 'LineString') {
                geometry.coordinates.forEach(function (c) {
                    points.push({ lat: Number(c[1]), lon: Number(c[0]) });
                });
            }
            if (points.length) return uniquePoints(points);
        } catch (_) {}

        var bang = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g;
        var m;
        while ((m = bang.exec(text)) !== null) {
            points.push({ lat: Number(m[1]), lon: Number(m[2]) });
        }

        var at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
        while ((m = at.exec(text)) !== null) {
            points.push({ lat: Number(m[1]), lon: Number(m[2]) });
        }

        if (!points.length) {
            text.split(/\r?\n|;/).forEach(function (line) {
                var pair = line.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
                if (pair) points.push({ lat: Number(pair[1]), lon: Number(pair[2]) });
            });
        }

        if (!points.length) {
            try {
                var u = new URL(text);
                var q = u.searchParams.get('query') || u.searchParams.get('q');
                if (q) {
                    var qp = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
                    if (qp) points.push({ lat: Number(qp[1]), lon: Number(qp[2]) });
                }
            } catch (_) {}
        }

        return uniquePoints(points);
    }

    function haversineKm(a, b) {
        var R = 6371.0088;
        var rad = Math.PI / 180;
        var dLat = (b.lat - a.lat) * rad;
        var dLon = (b.lon - a.lon) * rad;
        var la1 = a.lat * rad;
        var la2 = b.lat * rad;
        var h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function sampleLine(points, spacingKm) {
        points = uniquePoints(points);
        if (points.length < 2) return points;
        spacingKm = Math.max(0.25, Number(spacingKm) || 3);
        var out = [points[0]];

        for (var i = 0; i < points.length - 1; i++) {
            var a = points[i];
            var b = points[i + 1];
            var dist = haversineKm(a, b);
            var steps = Math.max(1, Math.ceil(dist / spacingKm));
            for (var j = 1; j <= steps; j++) {
                var t = j / steps;
                out.push({
                    lat: a.lat + (b.lat - a.lat) * t,
                    lon: a.lon + (b.lon - a.lon) * t
                });
            }
        }
        return capPoints(uniquePoints(out), 250);
    }

    function pointInRing(lon, lat, ring) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1];
            var xj = ring[j][0], yj = ring[j][1];
            var intersect = ((yi > lat) !== (yj > lat)) &&
                (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function pointInPolygon(lon, lat, polygonCoords) {
        if (!polygonCoords.length || !pointInRing(lon, lat, polygonCoords[0])) return false;
        for (var i = 1; i < polygonCoords.length; i++) {
            if (pointInRing(lon, lat, polygonCoords[i])) return false;
        }
        return true;
    }

    function pointInGeometry(lon, lat, geometry) {
        if (!geometry) return false;
        if (geometry.type === 'Polygon') return pointInPolygon(lon, lat, geometry.coordinates);
        if (geometry.type === 'MultiPolygon') {
            return geometry.coordinates.some(function (poly) { return pointInPolygon(lon, lat, poly); });
        }
        return false;
    }

    function geometryBounds(geometry) {
        var minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
        function visit(node) {
            if (!Array.isArray(node)) return;
            if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
                minLon = Math.min(minLon, node[0]);
                maxLon = Math.max(maxLon, node[0]);
                minLat = Math.min(minLat, node[1]);
                maxLat = Math.max(maxLat, node[1]);
                return;
            }
            node.forEach(visit);
        }
        visit(geometry.coordinates);
        return [minLon, minLat, maxLon, maxLat];
    }

    function samplePolygon(geometry, spacingKm) {
        var b = geometryBounds(geometry);
        if (!Number.isFinite(b[0])) return [];
        var midLat = (b[1] + b[3]) / 2;
        var latStep = Math.max(0.005, (Number(spacingKm) || 5) / 111.32);
        var lonScale = Math.max(0.2, Math.cos(midLat * Math.PI / 180));
        var lonStep = latStep / lonScale;
        var out = [];

        for (var lat = b[1] + latStep / 2; lat <= b[3]; lat += latStep) {
            for (var lon = b[0] + lonStep / 2; lon <= b[2]; lon += lonStep) {
                if (pointInGeometry(lon, lat, geometry)) out.push({ lat: lat, lon: lon });
                if (out.length > 1200) break;
            }
            if (out.length > 1200) break;
        }

        if (!out.length) {
            out.push({ lat: (b[1] + b[3]) / 2, lon: (b[0] + b[2]) / 2 });
        }
        return capPoints(out, 250);
    }

    document.getElementById('parse-location').addEventListener('click', function () {
        var pts = extractCoordinatePairs(document.getElementById('maps_location').value);
        if (!pts.length) {
            summary.textContent = 'Không đọc được tọa độ từ nội dung đã nhập.';
            return;
        }
        var p = pts[0];
        latInput.value = p.lat.toFixed(7);
        lonInput.value = p.lon.toFixed(7);
        activeGeometry = null;
        setCenters([p], 'Tâm tìm kiếm: ' + p.lat.toFixed(6) + ', ' + p.lon.toFixed(6) + ' · bán kính ' + radiusInput.value + ' m');
        map.setView([p.lat, p.lon], 13);
    });

    map.on('click', function (e) {
        if (mode !== 'radius') return;
        latInput.value = e.latlng.lat.toFixed(7);
        lonInput.value = e.latlng.lng.toFixed(7);
        activeGeometry = null;
        setCenters([{ lat: e.latlng.lat, lon: e.latlng.lng }], 'Tâm được chọn trên bản đồ · bán kính ' + radiusInput.value + ' m');
    });

    document.getElementById('build-route').addEventListener('click', function () {
        var raw = document.getElementById('route_input').value;
        var points = extractCoordinatePairs(raw);
        if (points.length < 2) {
            summary.textContent = 'Cần ít nhất 2 tọa độ để tạo tuyến.';
            return;
        }
        var sampled = sampleLine(points, document.getElementById('route_spacing').value);
        activeGeometry = {
            type: 'LineString',
            coordinates: points.map(function (p) { return [p.lon, p.lat]; })
        };
        setCenters(sampled, sampled.length + ' điểm lấy mẫu dọc tuyến');
    });

    async function loadBoundaryByName() {
        var q = document.getElementById('boundary_query').value.trim();
        if (!q) {
            boundaryStatus.textContent = 'Hãy nhập tên xã/phường/tỉnh thành.';
            return;
        }

        boundaryStatus.textContent = 'Đang tìm địa giới công khai từ OpenStreetMap/Nominatim…';
        try {
            var url = 'https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&limit=5&countrycodes=vn&accept-language=vi&q=' + encodeURIComponent(q);
            var res = await fetch(url, { headers: { 'Accept': 'application/geo+json, application/json' } });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            var feature = (data.features || []).find(function (f) {
                return f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
            });
            if (!feature) throw new Error('Không tìm thấy polygon hành chính phù hợp');

            activeGeometry = feature.geometry;
            var sampled = samplePolygon(activeGeometry, document.getElementById('boundary_spacing').value);
            setCenters(sampled, sampled.length + ' điểm lấy mẫu trong địa giới');
            boundaryStatus.textContent = feature.properties && feature.properties.display_name ?
                feature.properties.display_name : 'Đã nạp địa giới.';
        } catch (err) {
            boundaryStatus.textContent = 'Không nạp được địa giới: ' + err.message + '. Có thể tải GeoJSON thủ công.';
        }
    }

    document.getElementById('load-boundary').addEventListener('click', loadBoundaryByName);

    document.getElementById('boundary_file').addEventListener('change', function (event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var obj = JSON.parse(reader.result);
                var geom = obj.type === 'FeatureCollection' ? (obj.features[0] && obj.features[0].geometry) :
                    (obj.type === 'Feature' ? obj.geometry : obj);
                if (!geom) throw new Error('GeoJSON không có geometry');

                if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
                    activeGeometry = geom;
                    var sampled = samplePolygon(geom, document.getElementById('boundary_spacing').value);
                    setCenters(sampled, sampled.length + ' điểm lấy mẫu từ GeoJSON');
                    boundaryStatus.textContent = 'Đã nạp ' + file.name;
                } else if (geom.type === 'LineString') {
                    setMode('route');
                    var pts = geom.coordinates.map(function (c) { return { lat: Number(c[1]), lon: Number(c[0]) }; });
                    activeGeometry = geom;
                    var routeSample = sampleLine(pts, document.getElementById('route_spacing').value);
                    setCenters(routeSample, routeSample.length + ' điểm lấy mẫu từ LineString');
                } else {
                    throw new Error('Chỉ hỗ trợ Polygon, MultiPolygon hoặc LineString');
                }
            } catch (err) {
                boundaryStatus.textContent = 'Lỗi GeoJSON: ' + err.message;
            }
        };
        reader.readAsText(file);
    });

    document.getElementById('clear-spatial').addEventListener('click', function () {
        activeGeometry = null;
        setCenters([], 'Đã xóa phạm vi không gian.');
        latInput.value = '0';
        lonInput.value = '0';
        boundaryStatus.textContent = '';
    });

    document.body.addEventListener('htmx:configRequest', function (event) {
        if (!event.detail.elt || event.detail.elt.id !== 'spatial-search-form') return;

        var params = event.detail.parameters;
        geoModeInput.value = mode;

        if (!params.name || !String(params.name).trim()) {
            params.name = 'Spatial search ' + new Date().toISOString().slice(0, 19);
        }

        var rawKeywords = String(document.getElementById('keywords').value || '');
        var queryLines = rawKeywords.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        var areaHint = document.getElementById('area_hint').value.trim();

        if (mode === 'text' && areaHint) {
            queryLines = queryLines.map(function (q) {
                return q.toLowerCase().includes(areaHint.toLowerCase()) ? q : q + ' in ' + areaHint;
            });
        }

        if (!queryLines.length) {
            event.preventDefault();
            document.getElementById('error-container').textContent = 'Cần ít nhất một truy vấn.';
            return;
        }

        if (mode === 'radius') {
            var lat = number(latInput.value);
            var lon = number(lonInput.value);
            if (lat === null || lon === null || !validPoint({lat: lat, lon: lon}) || (lat === 0 && lon === 0)) {
                event.preventDefault();
                document.getElementById('error-container').textContent = 'Cần tọa độ hợp lệ cho chế độ bán kính.';
                return;
            }
            centers = [{ lat: lat, lon: lon }];
        }

        if ((mode === 'route' || mode === 'boundary') && !centers.length) {
            event.preventDefault();
            document.getElementById('error-container').textContent = 'Hãy tạo các điểm lấy mẫu cho phạm vi đã chọn.';
            return;
        }

        params.keywords = queryLines.join('\n');
        params.centers = centers.length ? JSON.stringify(centers) : '';
        params.geo_mode = mode;
    });

    setMode('text');
})();