(function () {
  'use strict';

  var initialCenter = [6.28, -75.59];
  var initialZoom = 12;
  function webMercatorToLatLng(x, y) {
    var lng = (x / 20037508.34) * 180;
    var lat = (y / 20037508.34) * 180;
    lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return [lat, lng];
  }
  var manriqueSouthWest = webMercatorToLatLng(-8410971.368524, 698894.894891);
  var manriqueNorthEast = webMercatorToLatLng(-8407927.578103, 700845.937304);
  var manriqueImageBounds = L.latLngBounds(manriqueSouthWest, manriqueNorthEast);
  var map = L.map('map', { zoomControl: false, rotate: true, bearing: 0, rotateControl: false, dragRotate: true, shiftKeyRotate: true, touchRotate: true, doubleClickZoom: true }).setView(initialCenter, initialZoom);
  var userChangedView = false;
  map.on('dragstart zoomstart', function () { userChangedView = true; });
  var imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri, Sources: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  });
  var streets = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri, DeLorme, NAVTEQ, USGS, Intermap, NRCAN, Esri Japan, METI, Esri China (Hong Kong), TomTom'
  });
  imagery.addTo(map);
  L.control.scale({ imperial: false, metric: true, maxWidth: 130, position: 'bottomright' }).addTo(map);

  var overlays = {};
  var drawings = L.featureGroup().addTo(map);
  var measurementLayer = L.layerGroup().addTo(map);
  var rasterBounds = L.latLngBounds();
  var activeAction = null;
  var vertices = [];
  var previewLine = null;
  var previewShape = null;
  var vertexMarkers = [];
  var bearing = 0;
  var layerList = document.getElementById('layer-list');
  var finishButton = document.getElementById('finish-draw');
  var cancelButton = document.getElementById('cancel-draw');
  var undoButton = document.getElementById('undo-draw');
  var hint = document.getElementById('draw-hint');
  var layerControlIndex = 0;

  function getLayerBounds(layer) {
    if (layer && typeof layer.getBounds === 'function') {
      var ownBounds = layer.getBounds();
      if (ownBounds && ownBounds.isValid()) return ownBounds;
    }
    var bounds = L.latLngBounds();
    if (layer && typeof layer.getLatLng === 'function') bounds.extend(layer.getLatLng());
    if (layer && typeof layer.eachLayer === 'function') {
      layer.eachLayer(function (child) {
        var childBounds = getLayerBounds(child);
        if (childBounds) bounds.extend(childBounds);
      });
    }
    return bounds.isValid() ? bounds : null;
  }

  var featureLabels = [];
  function updateFeatureLabels() {
    var zoom = map.getZoom();
    var bounds = map.getBounds();
    featureLabels.forEach(function (item) {
      var featureBounds = item.bounds;
      var visible = map.hasLayer(item.group) && zoom >= item.minZoom && featureBounds && bounds.intersects(featureBounds);
      if (visible) item.layer.openTooltip();
      else item.layer.closeTooltip();
    });
  }
  map.on('moveend zoomend', updateFeatureLabels);
  function addLayerControl(name, layer, color, checked, base) {
    var row = document.createElement('div');
    row.className = 'layer-item';
    var input = document.createElement('input');
    input.type = base ? 'radio' : 'checkbox';
    input.name = base ? 'base-layer' : 'overlay-' + name;
    input.checked = checked;
    input.id = 'layer-control-' + layerControlIndex++;
    var label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = name;
    var swatch = document.createElement('span');
    swatch.className = 'layer-swatch';
    swatch.style.setProperty('--swatch', color);
    var state = document.createElement('span');
    state.className = 'layer-state';
    state.textContent = base ? 'BASE' : 'ON';
    var extentButton = null;
    if (!base) {
      extentButton = document.createElement('button');
      extentButton.type = 'button';
      extentButton.className = 'layer-extent-button';
      extentButton.title = 'Acercar a esta capa';
      extentButton.setAttribute('aria-label', 'Acercar a ' + name);
      extentButton.textContent = '⌖';
      extentButton.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var extent = getLayerBounds(layer);
        if (extent) map.fitBounds(extent, { padding: [36, 36], maxZoom: 17 });
        else state.textContent = 'CARGANDO';
      });
    }
    input.addEventListener('change', function () {
      if (base) {
        if (input.checked) {
          if (map.hasLayer(imagery)) map.removeLayer(imagery);
          if (map.hasLayer(streets)) map.removeLayer(streets);
          layer.addTo(map);
          document.querySelectorAll('input[name="base-layer"]').forEach(function (radio) {
            radio.closest('.layer-item').querySelector('.layer-state').textContent = radio.checked ? 'BASE' : '—';
          });
        }
      } else {
        if (input.checked) layer.addTo(map);
        else map.removeLayer(layer);
        state.textContent = input.checked ? 'ON' : 'OFF';
        updateFeatureLabels();
      }
    });
    if (extentButton) row.append(input, swatch, label, state, extentButton);
    else row.append(input, swatch, label, state);
    layerList.appendChild(row);
  }

  addLayerControl('Imagen satelital', imagery, '#1976d2', true, true);
  addLayerControl('Mapa de calles', streets, '#0b2e59', false, true);

  function loadGeoTiffOverlay(path, name, options, color, initiallyVisible) {
    options = options || {};
    var group = L.layerGroup();
    overlays[name] = group;
    addLayerControl(name, group, color, initiallyVisible, false);
    if (initiallyVisible) group.addTo(map);

    fetch(path).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.arrayBuffer();
    }).then(function (buffer) {
      return parseGeoraster(buffer, { readOnDemand: true });
    }).then(function (georaster) {
      var raster = new GeoRasterLayer({
        georaster: georaster,
        resolution: 256,
        pixelValuesToColorFn: function (values) {
          if (values[0] == null || Number.isNaN(values[0])) return null;
          if (values.length < 3) return 'rgb(' + values[0] + ', ' + values[0] + ', ' + values[0] + ')';
          if (values.slice(0, 3).some(function (value) { return value == null || Number.isNaN(value); })) return null;

          var r, g, b;
          if (options.ycbcr) {
            var y = values[0], cb = values[1] - 128, cr = values[2] - 128;
            r = Math.round(y + 1.402 * cr);
            g = Math.round(y - 0.34414 * cb - 0.71414 * cr);
            b = Math.round(y + 1.772 * cb);
          } else {
            r = values[0];
            g = values[1];
            b = values[2];
          }
          if (options.fondoNegro && r <= 5 && g <= 5 && b <= 5) return null;
          if (values.length > 3) return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + values[3] / 255 + ')';
          return 'rgb(' + r + ', ' + g + ', ' + b + ')';
        }
      });
      group.addLayer(raster);
      var layerRow = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) {
        return item.querySelector('label').textContent === name;
      });
      if (layerRow) layerRow.querySelector('.layer-state').textContent = layerRow.querySelector('input').checked ? 'ON' : 'OFF';
      if (initiallyVisible && map.hasLayer(group) && !userChangedView) {
        map.fitBounds(options.viewBounds || raster.getBounds(), { padding: [28, 28], maxZoom: 17 });
      }
    }).catch(function (error) {
      console.error('No se pudo cargar ' + path + ':', error);
      var row = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) {
        return item.querySelector('label').textContent === name;
      });
      if (row) row.querySelector('.layer-state').textContent = 'ERROR';
    });

    return group;
  }

  loadGeoTiffOverlay('data/Manrique.tif', 'Manrique · GeoTIFF', { viewBounds: manriqueImageBounds }, '#cf91ff', true);

  var attributeFeatures = [];
  var attributePage = 0;
  var attributePageSize = 25;
  var attributeTitle = document.getElementById('attribute-table-title');
  var attributeSearch = document.getElementById('attribute-table-search');
  var attributeHead = document.getElementById('attribute-table-head');
  var attributeBody = document.getElementById('attribute-table-body');
  var attributePageLabel = document.getElementById('attribute-table-page');
  var attributePanel = document.getElementById('attribute-table-panel');

  var selectedFeatureLayer = null;
  function selectFeatureLayer(layer) {
    if (selectedFeatureLayer && selectedFeatureLayer !== layer && selectedFeatureLayer._originalFeatureStyle) {
      selectedFeatureLayer.setStyle(selectedFeatureLayer._originalFeatureStyle);
    }
    selectedFeatureLayer = layer;
    if (layer && typeof layer.setStyle === 'function') {
      layer.setStyle({ color: '#1976d2', weight: 4, opacity: 1, fillColor: '#1976d2', fillOpacity: 0.42, radius: 8 });
    }
  }

  function renderAttributeTable() {
    var query = attributeSearch.value.trim().toLocaleLowerCase('es');
    var filtered = attributeFeatures.filter(function (feature) {
      return Object.keys(feature.properties || {}).some(function (key) {
        return String(feature.properties[key] == null ? '' : feature.properties[key]).toLocaleLowerCase('es').indexOf(query) !== -1;
      });
    });
    var keys = [];
    filtered.forEach(function (feature) {
      Object.keys(feature.properties || {}).forEach(function (key) { if (keys.indexOf(key) === -1) keys.push(key); });
    });
    attributeHead.textContent = '';
    var headerRow = document.createElement('tr');
    keys.forEach(function (key) { var th = document.createElement('th'); th.textContent = key; headerRow.appendChild(th); });
    attributeHead.appendChild(headerRow);
    attributeBody.textContent = '';
    var pageCount = Math.max(1, Math.ceil(filtered.length / attributePageSize));
    attributePage = Math.min(attributePage, pageCount - 1);
    filtered.slice(attributePage * attributePageSize, (attributePage + 1) * attributePageSize).forEach(function (feature, index) {
      var tr = document.createElement('tr');
      tr.title = 'Acercar a esta entidad';
      tr.addEventListener('click', function () {
        var layer = feature._leafletLayer;
        selectFeatureLayer(layer);
        var bounds = getLayerBounds(layer);
        if (bounds) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
        if (layer && layer.getPopup && layer.getPopup()) layer.openPopup();
      });
      keys.forEach(function (key) { var td = document.createElement('td'); var value = feature.properties && feature.properties[key]; td.textContent = value == null ? '' : String(value); tr.appendChild(td); });
      attributeBody.appendChild(tr);
    });
    attributePageLabel.textContent = (filtered.length ? attributePage * attributePageSize + 1 : 0) + '–' + Math.min((attributePage + 1) * attributePageSize, filtered.length) + ' de ' + filtered.length;
    document.getElementById('attribute-table-prev').disabled = attributePage <= 0;
    document.getElementById('attribute-table-next').disabled = attributePage >= pageCount - 1;
  }

  function showAttributeTable(name, features) {
    attributeTitle.textContent = 'Tabla de atributos · ' + name;
    attributeFeatures = features;
    attributePage = 0;
    attributeSearch.value = '';
    renderAttributeTable();
    attributePanel.hidden = false;
  }

  attributeSearch.addEventListener('input', function () { attributePage = 0; renderAttributeTable(); });
  document.getElementById('attribute-table-close').addEventListener('click', function () { attributePanel.hidden = true; });
  document.getElementById('attribute-table-prev').addEventListener('click', function () { if (attributePage > 0) { attributePage--; renderAttributeTable(); } });
  document.getElementById('attribute-table-next').addEventListener('click', function () { attributePage++; renderAttributeTable(); });

  function riskColor(properties, kind) {
    var risk = String(properties && properties.riesgo || '').toLocaleLowerCase('es');
    if (kind === 'flood') {
      if (risk.indexOf('no mitigable') !== -1) return '#08306b';
      if (risk.indexOf('mitigable') !== -1) return '#2171b5';
      return '#9ecae1';
    }
    if (risk.indexOf('no mitigable') !== -1) return '#8c1d40';
    if (risk.indexOf('mitigable') !== -1) return '#d1495b';
    if (risk.indexOf('medio') !== -1) return '#f4a261';
    if (risk.indexOf('bajo') !== -1) return '#74c69d';
    return '#f6bd60';
  }

  function addRiskLegend(name, kind) {
    var items = kind === 'flood' ? [
      ['Alto no mitigable', '#08306b'], ['Alto mitigable', '#2171b5'], ['Con condiciones', '#9ecae1']
    ] : [
      ['Alto no mitigable', '#8c1d40'], ['Alto mitigable', '#d1495b'], ['Medio', '#f4a261'], ['Con condiciones', '#f6bd60'], ['Bajo', '#74c69d']
    ];
    var legend = document.createElement('div');
    legend.className = 'layer-legend';
    items.forEach(function (item) {
      var entry = document.createElement('span');
      var swatch = document.createElement('i');
      swatch.style.setProperty('--legend-color', item[1]);
      entry.append(swatch, document.createTextNode(item[0]));
      legend.appendChild(entry);
    });
    var row = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) { return item.querySelector('label').textContent === name; });
    if (row) row.after(legend);
  }
  function loadShapefileOverlay(path, name, color) {
    var group = L.layerGroup();
    overlays[name] = group;
    addLayerControl(name, group, color, false, false);
    var row = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) {
      return item.querySelector('label').textContent === name;
    });
    var showTable = true;
    if (showTable && row) {
      var tableButton = document.createElement('button');
      tableButton.type = 'button';
      tableButton.className = 'layer-table-button';
      tableButton.textContent = 'Tabla';
      tableButton.title = 'Ver tabla de atributos';
      tableButton.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); if (group.featureData) showAttributeTable(name, group.featureData); });
      row.appendChild(tableButton);
    }
    if (row) row.querySelector('.layer-state').textContent = 'CARGANDO';

    fetch(path).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.arrayBuffer();
    }).then(function (buffer) {
      return shp(buffer);
    }).then(function (geojson) {
      var collections = Array.isArray(geojson) ? geojson :
        (geojson && geojson.type === 'FeatureCollection' ? [geojson] : Object.keys(geojson || {}).map(function (key) { return geojson[key]; }));
      var features = collections.reduce(function (all, item) {
        if (item && item.type === 'FeatureCollection') return all.concat(item.features || []);
        if (item && item.type === 'Feature') all.push(item);
        return all;
      }, []);
      var isBoundary = path.indexOf('shp_barrios_y_veredas_mr') !== -1;
      var riskKind = path.indexOf('riesgos_inunda') !== -1 ? 'flood' : (path.indexOf('riesgos_movimi') !== -1 ? 'landslide' : null);
      var layer = L.geoJSON({ type: 'FeatureCollection', features: features }, {
        bubblingMouseEvents: true,
        style: function (feature) {
          var featureColor = riskKind ? riskColor(feature && feature.properties, riskKind) : color;
          return { color: isBoundary ? '#e8edf2' : featureColor, weight: isBoundary ? 1.25 : 1.5, opacity: 0.95, fillColor: featureColor, fillOpacity: isBoundary ? 0 : 0.48, className: isBoundary ? 'boundary-feature' : undefined };
        },
        pointToLayer: function (feature, latlng) {
          var pointColor = riskKind ? riskColor(feature && feature.properties, riskKind) : color;
          return L.circleMarker(latlng, { radius: 5, color: pointColor, weight: 1.5, fillColor: pointColor, fillOpacity: 0.75 });
        },
        onEachFeature: function (feature, featureLayer) {
          var properties = feature && feature.properties ? feature.properties : {};
          var content = document.createElement('div');
          var title = document.createElement('strong');
          title.textContent = name;
          content.appendChild(title);
          Object.keys(properties).forEach(function (key) {
            var line = document.createElement('div');
            line.textContent = key + ': ' + properties[key];
            content.appendChild(line);
          });
          featureLayer.bindPopup(content);
          featureLayer._originalFeatureStyle = Object.assign({}, featureLayer.options);
          featureLayer.on('click', function () {
            selectFeatureLayer(featureLayer);
            if (activeAction && featureLayer.closePopup) featureLayer.closePopup();
          });
          feature._leafletLayer = featureLayer;
          if (isBoundary) {
            var label = String(properties.nombre || properties.label || '').trim();
            if (label) {
              featureLayer.bindTooltip(label, { permanent: false, direction: 'center', className: 'map-feature-label', interactive: false });
              featureLabels.push({ layer: featureLayer, group: group, bounds: getLayerBounds(featureLayer), minZoom: isBoundary ? 13 : 16 });
            }
          }
        }
      });
      group.addLayer(layer);
      group.featureData = features;
      if (showTable) {
        if (row && !row.querySelector('.layer-table-button')) {
          var tableButton = document.createElement('button');
          tableButton.type = 'button';
          tableButton.className = 'layer-table-button';
          tableButton.textContent = 'Tabla';
          tableButton.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); showAttributeTable(name, group.featureData); });
          row.appendChild(tableButton);
        }
      }
      if (riskKind) addRiskLegend(name, riskKind);
      updateFeatureLabels();
      if (row) row.querySelector('.layer-state').textContent = row.querySelector('input').checked ? 'ON' : 'OFF';
    }).catch(function (error) {
      console.error('No se pudo cargar ' + path + ':', error);
      if (row) row.querySelector('.layer-state').textContent = 'ERROR';
    });
    return group;
  }

  // Las capas se cargan desde data y quedan disponibles para activarlas en el panel.
  loadShapefileOverlay('data/catastro_manzana.zip', 'Catastro por manzana', '#ffb703');
  loadShapefileOverlay('data/shp_barrios_y_veredas_mr.zip', 'Límites de barrios y veredas', '#06d6a0');
  loadShapefileOverlay('data/shp_pot48_2014_espacio_public.zip', 'Espacio público', '#00b4d8');
  loadShapefileOverlay('data/shp_pot48_2014_riesgos_inunda.zip', 'Riesgo de inundación', '#4361ee');
  loadShapefileOverlay('data/shp_pot48_2014_riesgos_movimi.zip', 'Riesgo de movimiento en masa', '#f72585');
  // Las capas temáticas del proyecto quedan desactivadas; solo se muestran los basemaps.
  if (false) {
  function bindFeaturePopup(feature, layer) {
    var properties = feature && feature.properties ? feature.properties : {};
    var content = document.createElement('div');
    var title = document.createElement('strong');
    title.textContent = 'Área de expansión';
    content.appendChild(title);
    Object.keys(properties).forEach(function (key) {
      var line = document.createElement('div');
      line.textContent = key + ': ' + properties[key];
      content.appendChild(line);
    });
    layer.bindPopup(content);
  }

  var expansion = new L.Shapefile('data/area_expan_robledo.zip', {
    onEachFeature: bindFeaturePopup,
    style: function () { return { color: '#1976d2', weight: 2, opacity: .9, fillColor: '#0b2e59', fillOpacity: .2 }; }
  });
  overlays['Área de expansión'] = expansion;
  expansion.addTo(map);
  addLayerControl('Área de expansión', expansion, '#1976d2', true, false);
  expansion.once('data:loaded', function () {
    try { if (expansion.getBounds().isValid()) map.fitBounds(expansion.getBounds(), { padding: [28, 28], maxZoom: 15 }); } catch (error) { console.warn('No fue posible ajustar el área al mapa.', error); }
  });

  function loadGeoTiff(path, name, options, color) {
    var group = L.layerGroup();
    overlays[name] = group;
    addLayerControl(name, group, color, true, false);
    group.addTo(map);
    fetch(path).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.arrayBuffer();
    }).then(function (buffer) {
      return parseGeoraster(buffer, { readOnDemand: true });
    }).then(function (georaster) {
      var raster = new GeoRasterLayer({
        georaster: georaster,
        resolution: 256,
        pixelValuesToColorFn: function (values) {
          if (values.slice(0, 3).some(function (value) { return value == null || Number.isNaN(value); })) return null;
          if (values.length > 3 && values[3] === 0) return null;
          var r, g, b;
          if (options.ycbcr) {
            var y = values[0], cb = values[1] - 128, cr = values[2] - 128;
            r = Math.round(y + 1.402 * cr);
            g = Math.round(y - 0.34414 * cb - 0.71414 * cr);
            b = Math.round(y + 1.772 * cb);
          } else { r = values[0]; g = values[1]; b = values[2]; }
          if (options.fondoNegro && r <= 5 && g <= 5 && b <= 5) return null;
          if (values.length > 3) return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + values[3] / 255 + ')';
          return 'rgb(' + r + ', ' + g + ', ' + b + ')';
        }
      });
      group.addLayer(raster);
      rasterBounds.extend(raster.getBounds());
    }).catch(function (error) {
      console.error('No se pudo cargar ' + path + ':', error);
      var row = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) { return item.querySelector('label').textContent === name; });
      if (row) row.querySelector('.layer-state').textContent = 'ERROR';
    });
  }
  loadGeoTiff('data/Iguana.tif', 'Iguana · GeoTIFF', { ycbcr: true, fondoNegro: true }, '#a855f7');
  loadGeoTiff('data/mede.tif', 'Mede · GeoTIFF', {}, '#cf91ff');
  }

  function updateActionButtons() {
    var active = !!activeAction;
    finishButton.disabled = !active || (activeAction && activeAction.kind === 'draw' && activeAction.type === 'marker') || vertices.length < (activeAction && activeAction.type === 'polygon' ? 3 : 2);
    cancelButton.disabled = !active;
    undoButton.disabled = !active || vertices.length === 0;
    finishButton.textContent = activeAction && activeAction.kind === 'measure' ? 'Terminar medición' : 'Finalizar dibujo';
    document.querySelectorAll('[data-draw]').forEach(function (button) {
      button.classList.toggle('active', activeAction && activeAction.kind === 'draw' && activeAction.type === button.dataset.draw);
    });
    document.querySelectorAll('[data-measure]').forEach(function (button) {
      button.classList.toggle('active', activeAction && activeAction.kind === 'measure' && activeAction.type === button.dataset.measure);
    });
  }

  function cleanTemporary() {
    if (previewLine) map.removeLayer(previewLine);
    if (previewShape) map.removeLayer(previewShape);
    previewLine = null;
    previewShape = null;
    vertexMarkers.forEach(function (marker) { map.removeLayer(marker); });
    vertexMarkers = [];
  }

  function endAction(message) {
    cleanTemporary();
    vertices = [];
    activeAction = null;
    document.body.classList.remove('drawing');
    map.doubleClickZoom.enable();
    hint.textContent = message || 'Selecciona una geometría para comenzar.';
    updateActionButtons();
  }

  function startAction(kind, type) {
    endAction('Haz clic en el mapa para agregar vértices.');
    activeAction = { kind: kind, type: type };
    if (kind === 'measure') {
      document.getElementById('measure-result').innerHTML = '<span class="result-dot"></span><span>Marca puntos en el mapa para medir.</span>';
      hint.textContent = type === 'distance' ? 'Marca al menos dos puntos; doble clic o “Terminar medición” para cerrar.' : 'Marca el contorno del polígono; necesitas tres puntos.';
    } else {
      hint.textContent = type === 'marker' ? 'Haz clic en el mapa para colocar el punto.' : 'Haz clic para agregar vértices y finaliza el dibujo.';
    }
    document.body.classList.add('drawing');
    map.doubleClickZoom.disable();
    updateActionButtons();
  }

  function formatDistance(meters) {
    return meters >= 1000 ? (meters / 1000).toLocaleString('es-CO', { maximumFractionDigits: 3 }) + ' km' : meters.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' m';
  }

  function geodesicArea(points) {
    var radius = 6378137;
    var area = 0;
    for (var i = 0, len = points.length; i < len; i++) {
      var p1 = points[i], p2 = points[(i + 1) % len];
      area += (p2.lng - p1.lng) * Math.PI / 180 * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
    }
    return Math.abs(area * radius * radius / 2);
  }

  function formatArea(area) {
    if (area >= 1000000) return (area / 1000000).toLocaleString('es-CO', { maximumFractionDigits: 4 }) + ' km²';
    return area.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' m²';
  }

  function pathLength(points, close) {
    var length = 0;
    for (var i = 1; i < points.length; i++) length += points[i - 1].distanceTo(points[i]);
    if (close && points.length > 2) length += points[points.length - 1].distanceTo(points[0]);
    return length;
  }

  function addVertex(point) {
    vertices.push(point);
    var marker = L.marker(point, { interactive: false, icon: L.divIcon({ className: 'draw-vertex', iconSize: [11, 11], iconAnchor: [5, 5] }) });
    marker.addTo(map);
    vertexMarkers.push(marker);
    updateActionButtons();
    if (activeAction.kind === 'measure') updateMeasurementPreview();
    else updateDrawingPreview();
  }

  function updateDrawingPreview() {
    if (previewLine) map.removeLayer(previewLine);
    if (previewShape) map.removeLayer(previewShape);
    if (vertices.length < 2) return;
    var style = { color: '#1976d2', weight: 3, opacity: .9, dashArray: '7 5' };
    if (activeAction.type === 'polygon' && vertices.length >= 3) previewShape = L.polygon(vertices, Object.assign({}, style, { fillColor: '#0b2e59', fillOpacity: .15 })).addTo(map);
    else previewLine = L.polyline(vertices, style).addTo(map);
  }

  function updateMeasurementPreview() {
    if (previewLine) map.removeLayer(previewLine);
    if (previewShape) map.removeLayer(previewShape);
    if (vertices.length < 2) return;
    var type = activeAction.type;
    if (type === 'distance') previewLine = L.polyline(vertices, { color: '#0b2e59', weight: 3, dashArray: '6 5' }).addTo(map);
    else if (vertices.length >= 3) previewShape = L.polygon(vertices, { color: '#0b2e59', weight: 2, fillColor: '#0b2e59', fillOpacity: .12, dashArray: '6 5' }).addTo(map);
    var result = document.getElementById('measure-result');
    if (type === 'distance') result.innerHTML = '<span class="result-dot"></span><span>Distancia: <b>' + formatDistance(pathLength(vertices, false)) + '</b></span>';
    else if (vertices.length >= 3) {
      var value = type === 'perimeter' ? formatDistance(pathLength(vertices, true)) : formatArea(geodesicArea(vertices));
      result.innerHTML = '<span class="result-dot"></span><span>' + (type === 'perimeter' ? 'Perímetro: ' : 'Área: ') + '<b>' + value + '</b></span>';
    }
  }

  function finishAction() {
    if (!activeAction) return;
    var action = activeAction;
    if (action.kind === 'draw') {
      if (action.type === 'marker') {
        if (vertices.length) {
          var marker = L.marker(vertices[0], { icon: L.divIcon({ className: 'draw-point-icon', html: '<span></span>', iconSize: [16, 16], iconAnchor: [8, 8] }) });
          marker.bindPopup('<b>Punto dibujado</b><br>' + vertices[0].lat.toFixed(6) + ', ' + vertices[0].lng.toFixed(6));
          drawings.addLayer(marker);
          endAction('Punto agregado al mapa.');
        }
      } else if ((action.type === 'polyline' && vertices.length >= 2) || (action.type === 'polygon' && vertices.length >= 3)) {
        var layer = action.type === 'polygon'
          ? L.polygon(vertices, { color: '#1976d2', weight: 3, fillColor: '#0b2e59', fillOpacity: .22 })
          : L.polyline(vertices, { color: '#1976d2', weight: 3 });
        var title = action.type === 'polygon' ? 'Polígono' : 'Línea';
        var detail = action.type === 'polygon' ? 'Área: ' + formatArea(geodesicArea(vertices)) + '<br>Perímetro: ' + formatDistance(pathLength(vertices, true)) : 'Longitud: ' + formatDistance(pathLength(vertices, false));
        layer.bindPopup('<b>' + title + ' dibujado</b><br>' + detail);
        drawings.addLayer(layer);
        endAction(title + ' agregado al mapa.');
      } else hint.textContent = 'Agrega más puntos antes de finalizar.';
    } else {
      if (action.type === 'distance' && vertices.length >= 2) {
        var line = L.polyline(vertices, { color: '#0b2e59', weight: 3 });
        line.bindPopup('Distancia: ' + formatDistance(pathLength(vertices, false)));
        measurementLayer.addLayer(line);
      } else if (vertices.length >= 3) {
        var polygon = L.polygon(vertices, { color: '#0b2e59', weight: 2, fillColor: '#0b2e59', fillOpacity: .15 });
        var measured = action.type === 'perimeter' ? formatDistance(pathLength(vertices, true)) : formatArea(geodesicArea(vertices));
        polygon.bindPopup((action.type === 'perimeter' ? 'Perímetro: ' : 'Área: ') + measured);
        measurementLayer.addLayer(polygon);
      } else { hint.textContent = 'Agrega más puntos antes de finalizar.'; return; }
      endAction('Medición guardada en el mapa.');
    }
  }

  map.on('click', function (event) {
    if (!activeAction) return;
    if (activeAction.kind === 'draw' && activeAction.type === 'marker') {
      vertices = [event.latlng];
      finishAction();
      return;
    }
    addVertex(event.latlng);
  });
  map.on('mousemove', function (event) {
    document.getElementById('coordinates').textContent = event.latlng.lat.toFixed(6) + '°, ' + event.latlng.lng.toFixed(6) + '°';
  });
  map.on('mouseout', function () { document.getElementById('coordinates').textContent = 'Mueve el cursor sobre el mapa'; });
  map.on('zoomend', updateZoom);
  function updateZoom() { document.getElementById('zoom-level').textContent = map.getZoom().toFixed(1); }
  updateZoom();

  document.querySelectorAll('[data-draw]').forEach(function (button) {
    button.addEventListener('click', function () { startAction('draw', button.dataset.draw); });
  });
  document.querySelectorAll('[data-measure]').forEach(function (button) {
    button.addEventListener('click', function () { startAction('measure', button.dataset.measure); });
  });
  finishButton.addEventListener('click', finishAction);
  cancelButton.addEventListener('click', function () { endAction('Acción cancelada.'); });
  undoButton.addEventListener('click', function () {
    if (!vertices.length) return;
    vertices.pop();
    var marker = vertexMarkers.pop();
    if (marker) map.removeLayer(marker);
    updateActionButtons();
    if (activeAction.kind === 'measure') updateMeasurementPreview(); else updateDrawingPreview();
  });
  map.on('dblclick', function (event) {
    if (!activeAction) return;
    if (activeAction.kind === 'measure') {
      L.DomEvent.stop(event.originalEvent);
      finishAction();
    }
  });
  document.getElementById('zoom-in').addEventListener('click', function () { map.zoomIn(); });
  document.getElementById('zoom-out').addEventListener('click', function () { map.zoomOut(); });
  document.getElementById('reset-view').addEventListener('click', function () { map.setView(initialCenter, initialZoom); setBearing(0); });
  document.getElementById('rotate-left').addEventListener('click', function () { setBearing(bearing - 15); });
  document.getElementById('rotate-right').addEventListener('click', function () { setBearing(bearing + 15); });
  document.querySelectorAll('[data-map-nav]').forEach(function (button) {
    button.addEventListener('click', function () {
      var action = button.dataset.mapNav;
      if (action === 'zoom-in') map.zoomIn();
      else if (action === 'zoom-out') map.zoomOut();
      else if (action === 'home') { map.setView(initialCenter, initialZoom); setBearing(0); }
      else if (action === 'north') setBearing(0);
      else if (action === 'rotate-left') setBearing(bearing - 15);
      else if (action === 'rotate-right') setBearing(bearing + 15);
    });
  });
  function syncBearingIndicator() {
    if (typeof map.getBearing === 'function') bearing = ((map.getBearing() % 360) + 360) % 360;
    document.getElementById('bearing-label').textContent = 'N · ' + Math.round(bearing) + '°';
    var compassArrow = document.querySelector('.map-compass-arrow');
    if (compassArrow) compassArrow.style.transform = 'rotate(' + (-bearing) + 'deg)';
  }

  function setBearing(value) {
    if (typeof map.setBearing !== 'function') {
      console.error('No se cargó el complemento de rotación de Leaflet.');
      return;
    }
    bearing = ((value % 360) + 360) % 360;
    map.setBearing(bearing);
    syncBearingIndicator();
  }
  map.on('rotate', syncBearingIndicator);
  document.getElementById('clear-drawings').addEventListener('click', function () {
    drawings.clearLayers();
    measurementLayer.clearLayers();
    document.getElementById('measure-result').innerHTML = '<span class="result-dot"></span><span>El resultado aparecerá aquí</span>';
    endAction('Geometrías y mediciones borradas.');
  });

  map.whenReady(function () { window.setTimeout(function () { map.invalidateSize(); }, 0); });
}());
