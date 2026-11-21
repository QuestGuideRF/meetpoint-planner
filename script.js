class MeetPointPlanner {
    constructor() {
        this.map = null;
        this.participants = [];
        this.meetingPoints = [];
        this.globalDestination = null;
        this.globalDestinationCoords = null;
        this.participantColors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DAD0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
        ];
        this.currentColorIndex = 0;
        this.markers = new Map();
        this.routes = new Map();
        this.meetingPointMarkers = new Map();
        this.globalDestinationMarker = null;
        this.isSelectingLocation = false;
        this.currentSelectionTarget = null;
        this.init();
    }
    init() {
        this.initMap();
        this.bindEvents();
        this.loadFromLocalStorage();
        this.updateStats();
    }
    initMap() {
        this.map = L.map('map').setView([55.7558, 37.6176], 10);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© Авторы OpenStreetMap'
        }).addTo(this.map);
        this.map.on('click', (e) => {
            this.handleMapClick(e);
        });
        this.addRouteLegend();
    }
    bindEvents() {
        document.getElementById('participantForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addParticipant();
        });
        document.getElementById('createMeetingPoint').addEventListener('click', () => {
            this.createMeetingPoint();
        });
        document.getElementById('clearMap').addEventListener('click', () => {
            this.clearMap();
        });
        document.getElementById('optimizeRoutes').addEventListener('click', () => {
            this.optimizeRoutes();
        });
        document.getElementById('saveData').addEventListener('click', () => {
            this.saveToLocalStorage();
        });
        document.getElementById('loadData').addEventListener('click', () => {
            this.loadFromLocalStorage();
        });
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('map-picker-btn') || e.target.parentElement.classList.contains('map-picker-btn')) {
                const btn = e.target.classList.contains('map-picker-btn') ? e.target : e.target.parentElement;
                this.startLocationSelection(btn.dataset.target);
            }
        });
        document.getElementById('globalDestination').addEventListener('change', () => {
            this.updateGlobalDestination();
        });
        document.getElementById('globalDestination').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.updateGlobalDestination();
            }
        });
    }
    async addParticipant() {
        const name = document.getElementById('participantName').value.trim();
        const startPoint = document.getElementById('startPoint').value.trim();
        const hasCar = document.getElementById('hasCar').checked;
        if (!name || !startPoint) {
            this.showNotification('Пожалуйста, заполните имя и стартовую точку', 'error');
            return;
        }
        if (!this.globalDestinationCoords) {
            this.showNotification('Сначала укажите конечную точку поездки', 'error');
            return;
        }
        try {
            const startCoords = await this.geocodeAddress(startPoint);
            if (!startCoords) {
                this.showNotification('Не удалось найти стартовый адрес', 'error');
                return;
            }
            const participant = {
                id: Date.now(),
                name,
                startPoint,
                endPoint: this.globalDestination,
                startCoords,
                endCoords: this.globalDestinationCoords,
                hasCar,
                color: this.participantColors[this.currentColorIndex % this.participantColors.length]
            };
            this.participants.push(participant);
            this.currentColorIndex++;
            this.addParticipantToMap(participant);
            this.updateParticipantsList();
            this.updateParticipantsCheckboxes();
            this.updateStats();
            this.clearParticipantForm();
            this.showNotification(`Участник ${name} добавлен`, 'success');
        } catch (error) {
            this.showNotification('Ошибка при добавлении участника', 'error');
        }
    }
    async geocodeAddress(address) {
        try {
            const coords = this.parseCoordinates(address);
            if (coords) return coords;
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
            const data = await response.json();
            if (data && data.length > 0) {
                return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
            }
            return null;
        } catch (error) {
            return null;
        }
    }
    addParticipantToMap(participant) {
        const startMarker = L.marker(participant.startCoords, {
            icon: L.divIcon({
                className: 'стартовый маркер пользовательского маркера',
                html: `<div style="background-color: ${participant.color}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
                iconSize: [20, 20]
            })
        }).addTo(this.map);
        startMarker.bindPopup(`<b>${participant.name}</b><br>Старт: ${this.getShortAddress(participant.startPoint)}`);
        const endMarker = L.marker(participant.endCoords, {
            icon: L.divIcon({
                className: 'конечный маркер пользовательского маркера',
                html: `<div style="background-color: ${participant.color}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); transform: rotate(45deg);"></div>`,
                iconSize: [20, 20]
            })
        }).addTo(this.map);
        endMarker.bindPopup(`<b>${participant.name}</b><br>Финиш: ${this.getShortAddress(participant.endPoint)}`);
        startMarker.dragging.enable();
        endMarker.dragging.enable();
        startMarker.on('dragend', (e) => {
            participant.startCoords = [e.target.getLatLng().lat, e.target.getLatLng().lng];
            this.clearParticipantRoute(participant);
            this.buildRoute(participant);
            this.showNotification(`Стартовая точка ${participant.name} обновлена!`, 'success');
        });
        endMarker.on('dragend', (e) => {
            participant.endCoords = [e.target.getLatLng().lat, e.target.getLatLng().lng];
            this.clearParticipantRoute(participant);
            this.buildRoute(participant);
            this.showNotification(`Конечная точка ${participant.name} обновлена!`, 'success');
        });
        this.markers.set(participant.id, { start: startMarker, end: endMarker });
        this.buildRoute(participant);
    }
    async buildRoute(participant, meetingPoint = null) {
        try {
            if (!participant.startCoords || !participant.endCoords) return;
            this.clearParticipantRoute(participant);
            let waypoints = [participant.startCoords];
            if (meetingPoint) waypoints.push(meetingPoint.coords);
            waypoints.push(participant.endCoords);
            const waypointsString = waypoints.map(wp => `${wp[1]},${wp[0]}`).join(';');
            const profile = participant.hasCar ? 'driving' : 'foot-walking';
            const url = `https://router.project-osrm.org/route/v1/${profile}/${waypointsString}?overview=full&geometries=geojson`;
            const routeResponse = await fetch(url);
            const routeData = await routeResponse.json();
            if (routeData.routes && routeData.routes.length > 0) {
                const route = routeData.routes[0];
                const routeStyle = {
                    color: participant.color,
                    weight: participant.hasCar ? 5 : 3,
                    opacity: 0.8,
                    lineCap: 'round',
                    lineJoin: 'round'
                };
                if (!participant.hasCar) {
                    routeStyle.dashArray = '10, 5';
                }
                const routeLayer = L.geoJSON(route.geometry, { style: routeStyle });
                routeLayer.addTo(this.map);
                this.routes.set(participant.id, routeLayer);
                participant.distance = (route.distance / 1000).toFixed(1);
                participant.duration = Math.round(route.duration / 60);
                const routeType = participant.hasCar ? 'автомобильный' : 'пешеходный';
                this.showNotification(`${routeType} маршрут построен для ${participant.name}`, 'success');
                this.fitMapToRoutes();
            } else {
                this.showNotification(`Не удалось построить маршрут для ${participant.name}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Ошибка построения маршрута для ${participant.name}`, 'error');
        }
    }
    addRouteLegend() {
        const legend = L.control({ position: 'bottomright' });
        legend.onAdd = function (map) {
            const div = L.DomUtil.create('div', 'route-legend');
            div.style.cssText = `
                цвет фона: белый;
                отступ: 10 пикселей;
                радиус границы: 5 пикселей;
                box-shadow: 0 0 10px rgba(0,0,0,0.3);
                размер шрифта: 12 пикселей;
                семейство шрифтов: Inter, без засечек;
            `;
            div.innerHTML = `
                <div style="margin-bottom: 8px; font-weight: bold; color: #333;">Типы маршрутов:</div>
                <div style="display: flex; align-items: center; margin-bottom: 5px;">
                    <div style="width: 20px; height: 3px; background: #FF6B6B; margin-right: 8px;"></div>
                    <span>Автомобильный</span>
                </div>
                <div style="display: flex; align-items: center; margin-bottom: 5px;">
                    <div style="width: 20px; height: 3px; background: #FF6B6B; border-top: 2px dashed #FF6B6B; margin-right: 8px;"></div>
                    <span>Пешеходный</span>
                </div>
                <div style="display: flex; align-items: center; margin-bottom: 5px;">
                    <div style="width: 20px; height: 4px; background: #667eea; border-top: 2px dashed #667eea; margin-right: 8px;"></div>
                    <span>Общий участок</span>
                </div>
            `;
            return div;
        };
        legend.addTo(this.map);
    }
    clearParticipantRoute(participant) {
        if (this.routes.has(participant.id)) {
            const oldRoute = this.routes.get(participant.id);
            try {
                if (oldRoute instanceof L.LayerGroup) {
                    oldRoute.eachLayer(layer => this.map.removeLayer(layer));
                } else {
                    this.map.removeLayer(oldRoute);
                }
                this.routes.delete(participant.id);
            } catch (error) {
                this.routes.delete(participant.id);
            }
        }
    }
    fitMapToRoutes() {
        try {
            const allLayers = [];
            this.markers.forEach(markers => {
                allLayers.push(markers.start);
                allLayers.push(markers.end);
            });
            if (this.globalDestinationMarker) {
                allLayers.push(this.globalDestinationMarker);
            }
            this.meetingPointMarkers.forEach(marker => {
                allLayers.push(marker);
            });
            if (allLayers.length > 0) {
                const group = new L.featureGroup(allLayers);
                this.map.fitBounds(group.getBounds().pad(0.1));
            }
        } catch (error) {

        }
    }
    async buildRouteWithMeetingPoint(participant, meetingPoint) {
        try {
            const startCoords = `${participant.startCoords[1]},${participant.startCoords[0]}`;
            const meetingCoords = `${meetingPoint.coords[1]},${meetingPoint.coords[0]}`;
            const endCoords = `${participant.endCoords[1]},${participant.endCoords[0]}`;
            const profile = participant.hasCar ? 'driving' : 'foot-walking';
            const route1Response = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${startCoords};${meetingCoords}?overview=full&geometries=geojson`);
            const route1Data = await route1Response.json();
            const route2Response = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${meetingCoords};${endCoords}?overview=full&geometries=geojson`);
            const route2Data = await route2Response.json();
            if (route1Data.routes && route1Data.routes.length > 0 && route2Data.routes && route2Data.routes.length > 0) {
                const route1 = route1Data.routes[0];
                const route2 = route2Data.routes[0];
                this.clearParticipantRoute(participant);
                const route1Style = {
                    color: participant.color,
                    weight: participant.hasCar ? 5 : 3,
                    opacity: 0.8,
                    lineCap: 'round',
                    lineJoin: 'round'
                };
                if (!participant.hasCar) {
                    route1Style.dashArray = '10, 5';
                }
                const route1Layer = L.geoJSON(route1.geometry, { style: route1Style }).addTo(this.map);
                const route2Style = {
                    color: '#667 да',
                    weight: participant.hasCar ? 6 : 4,
                    opacity: 0.9,
                    lineCap: 'round',
                    lineJoin: 'round'
                };
                if (!participant.hasCar) {
                    route2Style.dashArray = '15, 8';
                } else {
                    route2Style.dashArray = '10, 5';
                }
                const route2Layer = L.geoJSON(route2.geometry, { style: route2Style }).addTo(this.map);
                const routeGroup = L.layerGroup([route1Layer, route2Layer]);
                this.routes.set(participant.id, routeGroup);
                const totalDistance = (route1.distance + route2.distance) / 1000;
                const totalDuration = Math.round((route1.duration + route2.duration) / 60);
                participant.distance = totalDistance.toFixed(1);
                participant.duration = totalDuration;
                const routeType = participant.hasCar ? 'автомобильный' : 'пешеходный';
                this.fitMapToRoutes();
            }
        } catch (error) {
            this.showNotification(`Ошибка построения маршрута с точкой встречи для ${participant.name}`, 'error');
        }
    }
    updateParticipantsList() {
        const container = document.getElementById('participantsList');
        container.innerHTML = '';
        this.participants.forEach(participant => {
            const item = document.createElement('div');
            item.className = 'participant-item';
            item.style.borderLeftColor = participant.color;
            item.innerHTML = `
                <div class="participant-header">
                    <span class="participant-name">${participant.name}</span>
                    <div class="participant-actions">
                        <button onclick="app.removeParticipant(${participant.id})" title="Удалить">
                            <i class="fas fa-trash" style="color: #e53e3e;"></i>
                        </button>
                    </div>
                </div>
                <div class="participant-details">
                    <div><i class="fas fa-map-marker-alt"></i> ${this.getShortAddress(participant.startPoint)}</div>
                    <div><i class="fas fa-flag-checkered"></i> ${this.getShortAddress(participant.endPoint)}</div>
                    <div>
                        <span class="car-indicator ${participant.hasCar ? 'has-car' : 'no-car'}"></span>
                        ${participant.hasCar ? 'Есть машина' : 'Нет машины'}
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
    }
    updateParticipantsCheckboxes() {
        const container = document.getElementById('participantsCheckboxes');
        container.innerHTML = '';
        this.participants.forEach(participant => {
            const label = document.createElement('label');
            label.className = 'checkbox-label';
            label.innerHTML = `
                <input type="checkbox" value="${participant.id}">
                <span class="checkmark"></span>
                <span style="color: ${participant.color}; font-weight: 500;">${participant.name}</span>
            `;
            container.appendChild(label);
        });
    }
    removeParticipant(id) {
        const participant = this.participants.find(p => p.id === id);
        if (participant) {
            const markers = this.markers.get(id);
            if (markers) {
                this.map.removeLayer(markers.start);
                this.map.removeLayer(markers.end);
                this.markers.delete(id);
            }
            const route = this.routes.get(id);
            if (route) {
                this.map.removeLayer(route);
                this.routes.delete(id);
            }
            this.participants = this.participants.filter(p => p.id !== id);
            this.updateParticipantsList();
            this.updateParticipantsCheckboxes();
            this.updateStats();
            this.showNotification(`Участник ${participant.name} удален`, 'success');
        }
    }
    createMeetingPoint() {
        const location = document.getElementById('meetingPointLocation').value.trim();
        const selectedParticipants = Array.from(document.querySelectorAll('#participantsВвод флажков: отмечено'))
            .map(cb => parseInt(cb.value));
        if (!location) {
            this.showNotification('Укажите местоположение точки встречи', 'error');
            return;
        }
        if (selectedParticipants.length < 2) {
            this.showNotification('Выберите минимум 2 участника', 'error');
            return;
        }
        this.geocodeAddress(location).then(coords => {
            if (!coords) {
                this.showNotification('Не удалось найти указанное местоположение', 'error');
                return;
            }
            const meetingPoint = {
                id: Date.now(),
                name: location,
                coords: coords,
                participantIds: selectedParticipants
            };
            this.meetingPoints.push(meetingPoint);
            this.addMeetingPointToMap(meetingPoint);
            this.updateMeetingPointsList();
            this.updateStats();
            document.getElementById('meetingPointLocation').value = '';
            document.querySelectorAll('#participantsВвод флажков: отмечено').forEach(cb => cb.checked = false);
            this.showNotification(`Точка встречи создана`, 'success');
        });
    }
    addMeetingPointToMap(meetingPoint) {
        const marker = L.marker(meetingPoint.coords, {
            icon: L.divIcon({
                className: 'маркер встречи',
                html: `<div style="background-color: #667eea; width: 25px; height: 25px; border-radius: 50%; border: 4px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">🤝</div>`,
                iconSize: [25, 25]
            })
        }).addTo(this.map);
        marker.bindPopup(`<b>Точка встречи</b><br>${meetingPoint.name}`);
        marker.dragging.enable();
        marker.on('dragstart', () => {
            this.showNotification('Перетаскиваете точку встречи...', 'info');
        });
        marker.on('dragend', (e) => {
            meetingPoint.coords = [e.target.getLatLng().lat, e.target.getLatLng().lng];
            meetingPoint.participantIds.forEach(participantId => {
                const participant = this.participants.find(p => p.id === participantId);
                if (participant) {
                    this.clearParticipantRoute(participant);
                }
            });
            meetingPoint.participantIds.forEach(participantId => {
                const participant = this.participants.find(p => p.id === participantId);
                if (participant) {
                    this.buildRouteWithMeetingPoint(participant, meetingPoint);
                }
            });
            this.showNotification('Маршруты обновлены!', 'success');
        });
        meetingPoint.participantIds.forEach(participantId => {
            const participant = this.participants.find(p => p.id === participantId);
            if (participant) {
                this.buildRouteWithMeetingPoint(participant, meetingPoint);
            }
        });
        this.meetingPointMarkers.set(meetingPoint.id, marker);
    }
    updateMeetingPointsList() {
        const container = document.getElementById('meetingPointsList');
        container.innerHTML = '';
        this.meetingPoints.forEach(meetingPoint => {
            const participantNames = meetingPoint.participantIds
                .map(id => this.participants.find(p => p.id === id)?.name)
                .filter(name => name);
            const item = document.createElement('div');
            item.className = 'meeting-point-item';
            item.innerHTML = `
                <div class="meeting-point-header">
                    <span class="meeting-point-name">Точка встречи</span>
                    <button onclick="app.removeMeetingPoint(${meetingPoint.id})" style="background: none; border: none; cursor: pointer; color: #e53e3e;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="meeting-point-participants">
                    <i class="fas fa-map-marker-alt"></i> ${meetingPoint.name}
                </div>
                <div class="meeting-point-participants">
                    <i class="fas fa-users"></i> ${participantNames.join(', ')}
                </div>
            `;
            container.appendChild(item);
        });
    }
    removeMeetingPoint(id) {
        const meetingPoint = this.meetingPoints.find(mp => mp.id === id);
        if (meetingPoint) {
            const marker = this.meetingPointMarkers.get(id);
            if (marker) {
                this.map.removeLayer(marker);
                this.meetingPointMarkers.delete(id);
            }
            meetingPoint.participantIds.forEach(participantId => {
                const participant = this.participants.find(p => p.id === participantId);
                if (participant) {
                    this.clearParticipantRoute(participant);
                    this.buildRoute(participant);
                }
            });
            this.meetingPoints = this.meetingPoints.filter(mp => mp.id !== id);
            this.updateMeetingPointsList();
            this.updateStats();
            this.showNotification(`Точка встречи удалена`, 'success');
        }
    }
    handleMapClick(e) {
        if (this.isSelectingLocation && this.currentSelectionTarget) {
            this.setLocationFromMap(e.latlng);
        }
    }
    startLocationSelection(targetId) {
        this.isSelectingLocation = true;
        this.currentSelectionTarget = targetId;
        const btn = document.querySelector(`[data-target="${targetId}"]`);
        btn.classList.add('active');
        this.map.getContainer().style.cursor = 'crosshair';
        this.showNotification('Нажмите на карту для выбора точки', 'info');
    }
    async setLocationFromMap(latlng) {
        try {
            if (!this.currentSelectionTarget) {
                this.stopLocationSelection();
                return;
            }
            const input = document.getElementById(this.currentSelectionTarget);
            if (!input) {
                this.stopLocationSelection();
                return;
            }
            const address = await this.reverseGeocode(latlng);
            if (address) {
                input.value = address;
            } else {
                input.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
            }
            if (this.currentSelectionTarget === 'globalDestination') {
                this.globalDestination = input.value;
                this.globalDestinationCoords = [latlng.lat, latlng.lng];
                this.updateGlobalDestinationMarker();
                this.participants.forEach(participant => {
                    this.clearParticipantRoute(participant);
                    participant.endCoords = this.globalDestinationCoords;
                    participant.endPoint = this.globalDestination;
                    this.buildRoute(participant);
                });
            }
            this.stopLocationSelection();
            this.showNotification('Точка выбрана!', 'success');
        } catch (error) {
            this.showNotification('Ошибка при выборе точки', 'error');
            this.stopLocationSelection();
        }
    }
    stopLocationSelection() {
        this.isSelectingLocation = false;
        if (this.currentSelectionTarget) {
            const btn = document.querySelector(`[data-target="${this.currentSelectionTarget}"]`);
            if (btn) btn.classList.remove('active');
        }
        this.currentSelectionTarget = null;
        this.map.getContainer().style.cursor = '';
    }
    async reverseGeocode(latlng) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&zoom=18&addressdetails=1`);
            const data = await response.json();
            if (data && data.address) {
                const address = data.address;
                let shortAddress = '';
                if (address.house_number && address.road) {
                    shortAddress = `${address.house_number} ${address.road}`;
                } else if (address.road) {
                    shortAddress = address.road;
                } else if (address.suburb) {
                    shortAddress = address.suburb;
                } else if (address.city) {
                    shortAddress = address.city;
                }
                if (address.city && shortAddress !== address.city) {
                    shortAddress += `, ${address.city}`;
                }
                return shortAddress || data.display_name;
            }
            return null;
        } catch (error) {
            return null;
        }
    }
    async updateGlobalDestination() {
        const destination = document.getElementById('globalDestination').value.trim();
        if (!destination) {
            this.globalDestination = null;
            this.globalDestinationCoords = null;
            if (this.globalDestinationMarker) {
                this.map.removeLayer(this.globalDestinationMarker);
                this.globalDestinationMarker = null;
            }
            return;
        }
        try {
            const coords = this.parseCoordinates(destination);
            if (coords) {
                this.globalDestination = destination;
                this.globalDestinationCoords = coords;
            } else {
                const geocoded = await this.geocodeAddress(destination);
                if (geocoded) {
                    this.globalDestination = destination;
                    this.globalDestinationCoords = geocoded;
                } else {
                    this.showNotification('Не удалось найти указанный адрес', 'error');
                    return;
                }
            }
            this.updateGlobalDestinationMarker();
            this.participants.forEach(participant => {
                this.clearParticipantRoute(participant);
                participant.endCoords = this.globalDestinationCoords;
                this.buildRoute(participant);
            });
            this.showNotification('Конечная точка обновлена', 'success');
        } catch (error) {
            this.showNotification('Ошибка при обновлении конечной точки', 'error');
        }
    }
    updateGlobalDestinationMarker() {
        if (this.globalDestinationMarker) {
            this.map.removeLayer(this.globalDestinationMarker);
        }
        if (this.globalDestinationCoords) {
            this.globalDestinationMarker = L.marker(this.globalDestinationCoords, {
                icon: L.divIcon({
                    className: 'Маркер назначения пользовательского маркера',
                    html: `<div style="background-color: #667eea; width: 30px; height: 30px; border-radius: 50%; border: 4px solid white; box-shadow: 0 3px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px;">🎯</div>`,
                    iconSize: [30, 30]
                })
            }).addTo(this.map);
            this.globalDestinationMarker.bindPopup(`<b>Конечная точка</b><br>${this.globalDestination}`);
            this.globalDestinationMarker.dragging.enable();
            this.globalDestinationMarker.on('dragend', (e) => {
                this.globalDestinationCoords = [e.target.getLatLng().lat, e.target.getLatLng().lng];
                this.participants.forEach(participant => {
                    this.clearParticipantRoute(participant);
                    participant.endCoords = this.globalDestinationCoords;
                    this.buildRoute(participant);
                });
                this.showNotification('Глобальная конечная точка обновлена!', 'success');
            });
        }
    }
    parseCoordinates(str) {
        const coordRegex = /^(-?\d+\.?\d*),?\s*(-?\d+\.?\d*)$/;
        const match = str.match(coordRegex);
        if (match) {
            const lat = parseFloat(match[1]);
            const lng = parseFloat(match[2]);
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                return [lat, lng];
            }
        }
        return null;
    }
    getShortAddress(address) {
        if (!address) return '';
        if (this.parseCoordinates(address)) return address;
        const parts = address.split(', ');
        if (parts.length >= 3) {
            return parts.slice(0, 2).join(', ');
        } else if (parts.length >= 2) {
            return parts.join(', ');
        }
        return address;
    }
    clearMap() {
        if (confirm('Вы уверены, что хотите очистить карту?')) {
            this.participants = [];
            this.meetingPoints = [];
            this.globalDestination = null;
            this.globalDestinationCoords = null;
            this.markers.forEach(markers => {
                this.map.removeLayer(markers.start);
                this.map.removeLayer(markers.end);
            });
            this.markers.clear();
            this.routes.forEach(route => {
                this.map.removeLayer(route);
            });
            this.routes.clear();
            this.meetingPointMarkers.forEach(marker => {
                this.map.removeLayer(marker);
            });
            this.meetingPointMarkers.clear();
            if (this.globalDestinationMarker) {
                this.map.removeLayer(this.globalDestinationMarker);
                this.globalDestinationMarker = null;
            }
            document.getElementById('globalDestination').value = '';
            document.getElementById('participantForm').reset();
            this.updateParticipantsList();
            this.updateParticipantsCheckboxes();
            this.updateMeetingPointsList();
            this.updateStats();
            this.showNotification('Карта очищена', 'success');
        }
    }
    optimizeRoutes() {
        if (this.participants.length < 2) {
            this.showNotification('Добавьте минимум 2 участника для оптимизации', 'error');
            return;
        }
        const drivers = this.participants.filter(p => p.hasCar);
        const nonDrivers = this.participants.filter(p => !p.hasCar);
        if (drivers.length === 0) {
            this.showNotification('Нет участников с машинами для оптимизации', 'error');
            return;
        }
        drivers.forEach(driver => {
            const nearbyParticipants = nonDrivers.filter(p => {
                const distance = this.calculateDistance(driver.startCoords, p.startCoords);
                return distance < 5;
            });
            if (nearbyParticipants.length > 0) {
                const centerLat = (driver.startCoords[0] + nearbyParticipants[0].startCoords[0]) / 2;
                const centerLng = (driver.startCoords[1] + nearbyParticipants[0].startCoords[1]) / 2;
                const meetingPoint = {
                    id: Date.now() + Math.random(),
                    name: `Авто-встреча ${driver.name}`,
                    coords: [centerLat, centerLng],
                    participantIds: [driver.id, nearbyParticipants[0].id]
                };
                this.meetingPoints.push(meetingPoint);
                this.addMeetingPointToMap(meetingPoint);
            }
        });
        this.updateMeetingPointsList();
        this.updateStats();
        this.showNotification('Маршруты оптимизированы', 'success');
    }
    calculateDistance(coord1, coord2) {
        const R = 6371;
        const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;
        const dLon = (coord2[1] - coord1[1]) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(coord1[0] * Math.PI / 180) * Math.cos(coord2[0] * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
    updateStats() {
        document.getElementById('participantsCount').textContent = this.participants.length;
        document.getElementById('meetingPointsCount').textContent = this.meetingPoints.length;
    }
    clearParticipantForm() {
        document.getElementById('participantForm').reset();
    }
    saveToLocalStorage() {
        const data = {
            participants: this.participants,
            meetingPoints: this.meetingPoints,
            currentColorIndex: this.currentColorIndex,
            globalDestination: this.globalDestination,
            globalDestinationCoords: this.globalDestinationCoords
        };
        localStorage.setItem('meetPointPlannerData', JSON.stringify(data));
        this.showNotification('Данные сохранены', 'success');
    }
    loadFromLocalStorage() {
        const data = localStorage.getItem('meetPointPlannerData');
        if (data) {
            try {
                const parsedData = JSON.parse(data);
                this.clearMap();
                this.participants = parsedData.participants || [];
                this.meetingPoints = parsedData.meetingPoints || [];
                this.currentColorIndex = parsedData.currentColorIndex || 0;
                this.globalDestination = parsedData.globalDestination || null;
                this.globalDestinationCoords = parsedData.globalDestinationCoords || null;
                if (this.globalDestination) {
                    document.getElementById('globalDestination').value = this.globalDestination;
                    this.updateGlobalDestinationMarker();
                }
                this.participants.forEach(participant => {
                    this.addParticipantToMap(participant);
                });
                setTimeout(() => {
                    this.meetingPoints.forEach(meetingPoint => {
                        this.addMeetingPointToMap(meetingPoint);
                    });
                }, 500);
                this.updateParticipantsList();
                this.updateParticipantsCheckboxes();
                this.updateMeetingPointsList();
                this.updateStats();
                this.showNotification('Данные загружены', 'success');
            } catch (error) {
                this.showNotification('Ошибка загрузки данных', 'error');
            }
        }
    }
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `уведомление уведомление-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 3000;
            animation: slideIn 0.3s ease;
            max-width: 300px;
        `;
        const colors = {
            success: '#48bb78',
            error: '#f56565',
            info: '#4299e1'
        };
        notification.style.backgroundColor = colors[type] || colors.info;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.animation = 'SlideOut: легкость 0,3 с.';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new MeetPointPlanner();
});