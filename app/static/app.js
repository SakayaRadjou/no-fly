// ==========================================
// CONFIG & GLOBAL VARIABLES
// ==========================================
const MAPBOX_TOKEN = window.MAPBOX_TOKEN;
const OPENWEATHER_API_KEY = window.OPENWEATHER_API_KEY;
const isGuest = window.USER_ROLE === 'guest';
const weatherCache = {}; // Stores { 'lat,lon': { temp, icon, timestamp } }

let currentTripId = 1; // Replaced fixed tripId with dynamic currentTripId
let markersMap = {};
let routeLines = [];
let insertAtIndex = null;
let calendar;

// Helper to wait between API calls (for weather rate limits)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// INITIALIZATION & MAP SETUP
// ==========================================

// Initialize Map
const map = L.map('map', { zoomControl: false }).setView([13.7563, 100.5018], 5);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© CARTO',
    subdomains: 'abcd',
    maxZoom: 20
}).addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);

const customIcon = L.divIcon({
    className: 'custom-pin',
    html: `<div class="pin-wrapper"><div class="pin-dot"></div><div class="pin-pulse"></div></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

// App Startup
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Calendar
    const calendarEl = document.getElementById('calendar-el');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        height: '100%',
        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
        eventColor: '#3b82f6',
        displayEventTime: false,
        eventDidMount: function(info) {
            info.el.title = info.event.title; 
        }
    });

    // 2. Load Trips for Dropdown & Initialize Data
    await loadTrips();
    await loadItinerary();
});

// Initialize Drag & Drop
const listElement = document.getElementById('itinerary-list');
const sortable = new Sortable(listElement, {
    animation: 150,
    disabled: isGuest, // Security check
    handle: '.drag-handle',
    onEnd: () => {
        if (isGuest) return;
        recalculateNumbers();
        syncOrderToBackend();
        calculateRouting();
    }
});


// ==========================================
// TRIP MANAGEMENT (MULTI-TRIP)
// ==========================================

async function loadTrips() {
    try {
        const resp = await fetch('/trips/all');
        if (!resp.ok) return;
        
        const trips = await resp.json();
        const selector = document.getElementById('trip-selector');
        if (!selector) return;

        // Populate dropdown and ensure currentTripId matches selection
        selector.innerHTML = trips.map(t => 
            `<option value="${t.id}" ${t.id === currentTripId ? 'selected' : ''}>${t.name}</option>`
        ).join('');
        
        // If currentTripId is not in the list (e.g., first load), set it to the first trip
        if (trips.length > 0 && !trips.find(t => t.id === currentTripId)) {
            currentTripId = trips[0].id;
            selector.value = currentTripId;
        }
    } catch (e) {
        console.error("Failed to load trips list:", e);
    }
}

async function switchTrip(tripId) {
    currentTripId = parseInt(tripId);
    await loadItinerary(); // Reloads map, table, calendar, and sidebar for the new trip
}

async function createNewTripPrompt() {
    if (isGuest) return;

    const name = prompt("Nom du nouveau voyage :");
    if (!name) return;
    
    try {
        const resp = await fetch('/trips/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, default_transport_mode: 'voiture' })
        });
        
        if (resp.ok) {
            const newTrip = await resp.json();
            currentTripId = newTrip.id;
            await loadTrips(); // Refresh dropdown
            await switchTrip(newTrip.id); // Load the blank trip
        }
    } catch (e) {
        console.error("Error creating trip:", e);
    }
}


// ==========================================
// VIEW SWITCHING (MAP, TABLE, CALENDAR)
// ==========================================

function switchView(viewName) {
    document.querySelectorAll('.view-container').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.remove('bg-white', 'shadow-sm', 'text-blue-600');
        btn.classList.add('text-slate-500');
    });

    document.getElementById(`view-${viewName}`).classList.remove('hidden');
    document.getElementById(`btn-${viewName}`).classList.add('bg-white', 'shadow-sm', 'text-blue-600');
    
    if (viewName === 'calendar' && calendar) {
        calendar.render();
    }

    if (viewName === 'table') {
        updateAdvancedViews();
    }
}


// ==========================================
// DATE & CALENDAR LOGIC
// ==========================================

function calculateItineraryDates() {
    const startInput = document.getElementById('trip-start-date');
    if (!startInput || !startInput.value) return;

    let calendarDate = new Date(startInput.value);
    const steps = Array.from(document.querySelectorAll('.step-container'));

    steps.forEach((stepElement, index) => {
        const stepId = parseInt(stepElement.id.replace('step-', ''));
        const isFixed = document.getElementById(`fix-check-${stepId}`).checked;
        const fixedVal = document.getElementById(`fixed-date-val-${stepId}`).value;
        const nights = parseInt(document.getElementById(`nights-val-${stepId}`).innerText) || 0;
        
        // Handle custom format "HH:mm" from our text input bypass
        const timeVal = document.getElementById(`duration-input-${stepId}`)?.value || "00:00";
        const hours = parseInt(timeVal.split(':')[0]) || 0;

        // --- ANCHOR LOGIC ---
        if (isFixed && fixedVal) {
            calendarDate = new Date(fixedVal);
        } else if (index > 0 && hours >= 14) {
            calendarDate.setDate(calendarDate.getDate() + 1);
        }

        const badge = document.getElementById(`date-badge-${stepId}`);
        
        // Date Formatting: "3 Mars"
        const day = calendarDate.getDate();
        const month = calendarDate.toLocaleDateString('fr-FR', { month: 'long' });
        const formattedDateFR = `${day} ${month.charAt(0).toUpperCase() + month.slice(1)}`;
        
        badge.innerText = formattedDateFR; 
        badge.dataset.fullDate = calendarDate.toISOString().split('T')[0];
        badge.dataset.frenchDate = formattedDateFR;

        calendarDate.setDate(calendarDate.getDate() + nights);
        badge.dataset.departureDate = calendarDate.toISOString().split('T')[0];
    });

    syncCalendarOnly();
}

function syncCalendarOnly() {
    const events = [];
    const steps = Array.from(document.querySelectorAll('.step-container'));
    
    steps.forEach((stepEl, i) => {
        const id = parseInt(stepEl.id.replace('step-', ''));
        const city = stepEl.querySelector('.font-semibold').innerText;
        const badge = document.getElementById(`date-badge-${id}`);
        
        const arrivalDate = badge?.dataset.fullDate;
        const departureDate = badge?.dataset.departureDate;

        if (arrivalDate && departureDate) {
            let actualEnd = departureDate;
            // Stretch event to next arrival if available
            if (i < steps.length - 1) {
                const nextId = parseInt(steps[i+1].id.replace('step-', ''));
                const nextArrival = document.getElementById(`date-badge-${nextId}`)?.dataset.fullDate;
                if (nextArrival) actualEnd = nextArrival;
            }
            events.push({ 
                title: `📍 ${city}`, 
                start: arrivalDate, 
                end: actualEnd, 
                allDay: true,
                backgroundColor: '#3b82f6'
            });
        }
    });

    if (calendar) {
        calendar.removeAllEvents();
        calendar.addEventSource(events);
    }
}

async function toggleFixedDate(id, isChecked) {
    if (isGuest) return;

    const dateInput = document.getElementById(`fixed-date-val-${id}`);
    const badge = document.getElementById(`date-badge-${id}`);
    
    dateInput.classList.toggle('hidden', !isChecked);
    badge.classList.toggle('hidden', isChecked);
    
    if (isChecked && !dateInput.value && badge.dataset.fullDate) {
         dateInput.value = badge.dataset.fullDate;
    }

    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            is_fixed_date: isChecked,
            fixed_date: isChecked ? dateInput.value : null
        })
    });
    
    calculateItineraryDates();
}

async function updateFixedDateValue(id, value) {
    if (isGuest) return;
    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixed_date: value })
    });
    calculateItineraryDates();
}


// ==========================================
// CORE DATA LOADING & RENDERING
// ==========================================

async function loadItinerary() {
    try {
        const res = await fetch(`/trips/${currentTripId}/steps/`);
        if (!res.ok) throw new Error("Failed to fetch itinerary");
        
        const steps = await res.json();
        
        // Clear UI and Map
        listElement.innerHTML = ''; 
        Object.values(markersMap).forEach(m => map.removeLayer(m));
        routeLines.forEach(l => map.removeLayer(l));
        markersMap = {};
        routeLines = [];
        
        steps.sort((a, b) => a.position - b.position).forEach(s => renderStep(s));
        
        if (steps.length > 0) {
            const group = new L.featureGroup(Object.values(markersMap));
            map.fitBounds(group.getBounds().pad(0.2));
            
            calculateItineraryDates();
            calculateRouting();
        } else {
            // Reset calendar if empty trip
            if (calendar) calendar.removeAllEvents();
        }
    } catch (err) {
        console.error("Error loading itinerary:", err);
    }
}

function renderStep(step) {
    const currentMode = step.transport_mode || 'voiture';
    const item = document.createElement('div');
    item.id = `step-${step.id}`;
    
    item.className = "step-container relative mb-2";
    item.dataset.country = step.country || "Inconnu";
    item.dataset.countryCode = step.country_code || ""; 
    item.dataset.lat = step.lat;
    item.dataset.lon = step.lon;

    item.innerHTML = `
        <div class="leg-info ml-14 mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
            <span class="text-[10px]">⏱ Trajet:</span>
            <input type="time" 
                id="duration-input-${step.id}" 
                name="duration"
                value="${step.duration || '00:00'}"
                class="${isGuest ? 'pointer-events-none' : ''} bg-slate-50 border border-slate-200 rounded px-1 py-0.5 outline-none text-slate-600 focus:ring-1 focus:ring-blue-200"
                onchange="updateDuration(${step.id}, this.value)">
        </div>

        <div class="flex items-center gap-2 ml-auto justify-end pr-2">
            <div class="admin-only flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1">
                <input type="checkbox" id="fix-check-${step.id}" 
                    ${step.is_fixed_date ? 'checked' : ''} 
                    onchange="toggleFixedDate(${step.id}, this.checked)"
                    class="w-3 h-3 text-blue-600">
                <label class="text-[9px] font-bold text-slate-400 uppercase">Anchor</label>
            </div>

            <input type="date" id="fixed-date-val-${step.id}" 
                value="${step.fixed_date || ''}"
                class="${step.is_fixed_date ? '' : 'hidden'} ${isGuest ? 'pointer-events-none' : ''} bg-blue-50 border border-blue-200 rounded text-[10px] p-0.5 outline-none"
                onchange="updateFixedDateValue(${step.id}, this.value)">

            <span id="date-badge-${step.id}" class="${step.is_fixed_date ? 'hidden' : ''} text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold"></span>
        </div>

        <div class="p-4 bg-white border border-slate-200 rounded-xl flex flex-col shadow-sm relative z-20">
            <div class="flex justify-between items-center w-full">
                <div class="flex items-center gap-3 ${isGuest ? '' : 'cursor-pointer'} flex-grow" onclick="${isGuest ? '' : `toggleTransport(${step.id})`}">
                    <div class="step-number-circle w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-100 flex-shrink-0">
                    </div>
                    <div class="flex flex-col">
                        <span class="font-semibold text-slate-700 leading-tight">${step.city_name}</span>
                        <span class="text-[9px] text-slate-400 uppercase tracking-widest">${step.country || ''}</span>
                        
                        <div id="transport-container-${step.id}" class="mt-2 hidden">
                            <select class="transport-select text-[11px] p-1 border rounded bg-slate-50 outline-none" 
                                    onchange="handleTransportChange(${step.id}, this.value)" onclick="event.stopPropagation()">
                                <option value="voiture" ${currentMode === 'voiture' ? 'selected' : ''}>🚗 Voiture</option>
                                <option value="stop" ${currentMode === 'stop' ? 'selected' : ''}>👍 Stop</option>
                                <option value="bus" ${currentMode === 'bus' ? 'selected' : ''}>🚌 Bus</option>
                                <option value="pied" ${currentMode === 'pied' ? 'selected' : ''}>🚶 Pieds</option>
                                <option value="train" ${currentMode === 'train' ? 'selected' : ''}>🚆 Train</option>
                                <option value="ferry" ${currentMode === 'ferry' ? 'selected' : ''}>⛴ Ferry</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="flex items-center gap-3">
                    <div class="flex items-center bg-slate-50 rounded-lg border px-2 py-1 gap-2">
                        <button onclick="updateNights(${step.id}, -1)" class="admin-only text-slate-400 hover:text-blue-500 font-bold px-1">-</button>
                        <span id="nights-val-${step.id}" class="text-xs font-bold text-slate-700 w-3 text-center">${step.nights || 1}</span>
                        <button onclick="updateNights(${step.id}, 1)" class="admin-only text-slate-400 hover:text-blue-500 font-bold px-1">+</button>
                    </div>
                    
                    <span class="admin-only drag-handle text-slate-300 cursor-move p-1 hover:text-slate-500 transition-colors">⋮⋮</span>
                    
                    <button onclick="removeStep(${step.id})" class="admin-only text-slate-300 hover:text-red-400">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            </div>
            
            <textarea class="mt-3 w-full text-[11px] p-2 bg-slate-50 border-none rounded-lg text-slate-500 italic outline-none focus:ring-1 focus:ring-blue-100 ${isGuest ? 'pointer-events-none' : ''}" 
                      placeholder="Notes..." onchange="updateNotes(${step.id}, this.value)">${step.notes || ''}</textarea>
        </div>

        <div class="admin-only insert-connector flex justify-center py-2 relative z-30">
            <button onclick="setInsertPosition(${step.id})" 
                class="bg-white text-blue-400 border border-blue-100 rounded-full p-1 shadow-sm hover:bg-blue-500 hover:text-white transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 4v16m8-8H4" /></svg>
            </button>
        </div>
    `;

    // Add to DOM
    if (insertAtIndex !== null) {
        listElement.insertBefore(item, listElement.children[insertAtIndex + 1] || null);
        insertAtIndex = null;
        document.getElementById('insert-label').classList.add('hidden');
    } else {
        listElement.appendChild(item);
    }
    
    // Add Marker to map
    const marker = L.marker([step.lat, step.lon], { icon: customIcon }).addTo(map);
    markersMap[step.id] = marker;

    recalculateNumbers();
}


// ==========================================
// ROUTING (MAPBOX API)
// ==========================================

async function calculateRouting() {
    routeLines.forEach(l => map.removeLayer(l));
    routeLines = [];
    const steps = Array.from(document.querySelectorAll('.step-container'));
    
    for (let i = 1; i < steps.length; i++) {
        const currId = parseInt(steps[i].id.replace('step-', ''));
        const prevId = parseInt(steps[i-1].id.replace('step-', ''));
        
        const modeSelect = document.querySelector(`#step-${currId} .transport-select`);
        const mode = modeSelect ? modeSelect.value : 'voiture';
        const input = document.getElementById(`duration-input-${currId}`);

        const start = markersMap[prevId].getLatLng();
        const end = markersMap[currId].getLatLng();

        if (['voiture', 'stop', 'bus', 'pied'].includes(mode)) {
            const profile = mode === 'pied' ? 'walking' : 'driving';
            try {
                const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${start.lng},${start.lat};${end.lng},${end.lat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`);
                const data = await res.json();
                
                if(data.routes && data.routes.length > 0) {
                    const line = L.polyline(data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]), { color: '#3b82f6', weight: 3, opacity: 0.5 }).addTo(map);
                    routeLines.push(line);
                    
                    let dur = data.routes[0].duration;
                    if (mode === 'stop') dur *= 1.5;
                    if (mode === 'bus') dur *= 1.1;

                    let h = Math.floor(dur / 3600);
                    let m = Math.floor((dur % 3600) / 60);

                    // Cap at 23:59 so the HTML <input type="time"> doesn't crash
                    if (h > 23) {
                        h = 23;
                        m = 59;
                    }

                    const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

                    // Only overwrite if empty/default AND user hasn't edited
                    if ((input.value === "00:00" || input.value === "") && !input.dataset.userEdited) {
                        input.value = formatted;
                    }
                }
            } catch(e) { console.error("Route error", e); }
        } else {
            // Dash line for Train/Ferry
            const line = L.polyline([start, end], { color: '#cbd5e1', weight: 2, dashArray: '5, 10' }).addTo(map);
            routeLines.push(line);
        }
    }
    // Update calendar dates after routing might have changed durations
    calculateItineraryDates();
}


// ==========================================
// SEARCH & AUTOCOMPLETE
// ==========================================

const searchInput = document.getElementById('city-search');
const resultsContainer = document.getElementById('autocomplete-results');

if (searchInput) {
    searchInput.addEventListener('input', async (e) => {
        const query = e.target.value;
        if (query.length < 3) {
            resultsContainer.classList.add('hidden');
            return;
        }

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&types=place,address&limit=5`;
        
        try {
            const res = await fetch(url);
            const data = await res.json();
            
            resultsContainer.innerHTML = '';
            resultsContainer.classList.remove('hidden');

            data.features.forEach(feature => {
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-slate-50 cursor-pointer text-sm border-b last:border-none";
                div.innerText = feature.place_name;
                div.onclick = () => addStep(feature);
                resultsContainer.appendChild(div);
            });
        } catch (err) {
            console.error("Search error:", err);
        }
    });
}

document.addEventListener('click', (e) => {
    if (searchInput && !searchInput.contains(e.target)) {
        if(resultsContainer) resultsContainer.classList.add('hidden');
    }
});


// ==========================================
// CRUD OPERATIONS (DB SYNC)
// ==========================================

async function addStep(feature) {
    if (isGuest) return;

    const [lon, lat] = feature.center;
    const cityName = feature.text;
    
    let countryName = "Inconnu";
    let countryCode = "";

    if (feature.context) {
        const countryContext = feature.context.find(c => c.id.startsWith('country'));
        if (countryContext) {
            countryName = countryContext.text;
            countryCode = countryContext.short_code ? countryContext.short_code.toUpperCase() : "";
        }
    }

    let position = insertAtIndex !== null ? insertAtIndex + 1 : document.querySelectorAll('.step-container').length;

    const newStep = {
        city_name: cityName,
        country: countryName,
        country_code: countryCode,
        lat: lat,
        lon: lon,
        position: position,
        nights: 1,
        transport_mode: 'voiture'
    };

    try {
        const response = await fetch(`/trips/${currentTripId}/steps/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newStep)
        });

        if (response.ok) {
            const savedStep = await response.json();
            searchInput.value = '';
            resultsContainer.classList.add('hidden');
            
            if (insertAtIndex !== null) {
                // If inserted in middle, easiest way to fix positions is full reload
                await loadItinerary();
                insertAtIndex = null;
                document.getElementById('insert-label').classList.add('hidden');
            } else {
                renderStep(savedStep);
                calculateRouting();
            }
        }
    } catch (err) {
        console.error("Error adding step:", err);
    }
}

async function removeStep(id) {
    if (isGuest) return;
    if (!confirm("Supprimer cette étape ?")) return;

    try {
        const response = await fetch(`/steps/${id}`, { method: 'DELETE' });
        if (response.ok) {
            document.getElementById(`step-${id}`).remove();
            if (markersMap[id]) {
                map.removeLayer(markersMap[id]);
                delete markersMap[id];
            }
            recalculateNumbers();
            calculateRouting();
            syncOrderToBackend(); // Update positions for remaining items
        }
    } catch (err) {
        console.error("Error deleting step:", err);
    }
}

async function syncOrderToBackend() {
    if (isGuest) return;
    const stepElements = Array.from(document.querySelectorAll('.step-container'));
    const stepIds = stepElements.map(el => parseInt(el.id.replace('step-', '')));

    try {
        await fetch('/steps/reorder', { 
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stepIds) 
        });
    } catch (err) {
        console.error("Network error during reorder:", err);
    }
}

// ==========================================
// UI INTERACTION HELPERS
// ==========================================

function recalculateNumbers() {
    document.querySelectorAll('.step-number-circle').forEach((el, i) => el.innerText = i + 1);
}

function toggleTransport(id) {
    if (isGuest) return;
    document.getElementById(`transport-container-${id}`).classList.toggle('hidden');
}

async function handleTransportChange(id, mode) {
    if (isGuest) return;
    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transport_mode: mode })
    });
    calculateRouting();
}

async function updateNights(id, delta) {
    if (isGuest) return;
    const el = document.getElementById(`nights-val-${id}`);
    let val = Math.max(0, parseInt(el.innerText) + delta);
    el.innerText = val;
    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nights: val })
    });
    calculateItineraryDates();
}

async function updateNotes(id, text) {
    if (isGuest) return;
    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: text })
    });
}

async function updateDuration(id, value) {
    if (isGuest) return;
    const input = document.getElementById(`duration-input-${id}`);
    if(input) input.dataset.userEdited = "true"; // Mark so routing doesn't overwrite
    
    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: value })
    });
    calculateItineraryDates();
}

function setInsertPosition(indexOrId) {
    if (typeof indexOrId === 'number' && indexOrId !== -1) {
        const steps = Array.from(document.querySelectorAll('.step-container'));
        insertAtIndex = steps.findIndex(el => el.id === `step-${indexOrId}`);
    } else {
        insertAtIndex = indexOrId; 
    }
    
    const label = document.getElementById('insert-label');
    if (label) {
        label.classList.remove('hidden');
        label.className = "mt-2 p-2 bg-blue-50 text-blue-600 rounded-lg text-xs flex justify-between items-center";
        const positionText = insertAtIndex === -1 ? "au tout début" : `après l'étape ${insertAtIndex + 1}`;
        label.innerHTML = `
            <span>📍 Prochaine ville insérée <b>${positionText}</b></span>
            <button onclick="cancelInsertion()" class="font-bold hover:text-blue-800">Annuler</button>
        `;
    }
}

function cancelInsertion() {
    insertAtIndex = null;
    const label = document.getElementById('insert-label');
    if (label) label.classList.add('hidden');
}


// ==========================================
// TABLE VIEW & WEATHER (ERA5 CLIMATE)
// ==========================================

function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "🏳️";
    const codePoints = countryCode.toUpperCase().split('').map(char =>  127397 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
}

function getTransportEmoji(mode) {
    const modes = { 'voiture': '🚗', 'bus': '🚌', 'train': '🚆', 'ferry': '⛴', 'pied': '🚶', 'stop': '👍' };
    return modes[mode.toLowerCase()] || '🚗';
}

async function updateAdvancedViews() {
    const tableBody = document.getElementById('table-body');
    if (!tableBody) return;
        
    let rowsHtml = '';
    const steps = Array.from(document.querySelectorAll('.step-container'));
    
    // 1: Sync Calendar Events & Build Table HTML
    syncCalendarOnly();

    for (const [i, stepEl] of steps.entries()) {
        const id = parseInt(stepEl.id.replace('step-', ''));
        const city = stepEl.querySelector('.font-semibold').innerText;
        const badge = document.getElementById(`date-badge-${id}`);
        
        const countryName = stepEl.dataset.country || "Inconnu";
        const countryCode = stepEl.dataset.countryCode || ""; 
        const nights = document.getElementById(`nights-val-${id}`)?.innerText || "0";
        const transport = document.querySelector(`#step-${id} .transport-select`)?.value || "voiture";
        const notesValue = stepEl.querySelector('textarea').value;

        rowsHtml += `
            <tr class="border-b hover:bg-slate-50 transition-all">
                <td class="text-center font-bold text-slate-300 p-4">${i+1}</td>
                <td class="font-bold text-slate-800">${city}</td>
                <td class="text-slate-600">
                    <span class="text-xl mr-2">${getFlagEmoji(countryCode)}</span>
                    <span class="text-[10px] font-bold uppercase tracking-tighter text-slate-400">${countryName}</span>
                </td>
                <td class="text-blue-600 font-medium whitespace-nowrap">${badge?.dataset.frenchDate || '---'}</td>
                <td class="text-slate-500 text-sm">${nights} nuits</td>
                <td class="text-slate-500 text-sm">
                    <span class="mr-1">${getTransportEmoji(transport)}</span> 
                    <span class="capitalize">${transport}</span>
                </td>
                <td class="p-4" id="weather-td-${id}">
                    <div class="flex items-center gap-2">
                        <div class="weather-loading w-8 h-8 rounded-full bg-slate-200 animate-pulse"></div>
                        <div class="flex flex-col gap-1">
                            <div class="w-12 h-3 bg-slate-200 animate-pulse rounded"></div>
                            <div class="w-8 h-2 bg-slate-200 animate-pulse rounded"></div>
                        </div>
                    </div>
                </td>
                <td class="p-2">
                    <textarea class="w-full text-[11px] bg-transparent border-none outline-none resize-none text-slate-500 min-h-[40px] ${isGuest ? 'pointer-events-none' : ''}" 
                            onchange="updateTableNotes(${id}, this.value)">${notesValue}</textarea>
                </td>
            </tr>`;
    }

    tableBody.innerHTML = rowsHtml;

    // 2: Async Weather Fetching
    for (const stepEl of steps) {
        const id = parseInt(stepEl.id.replace('step-', ''));
        const lat = stepEl.dataset.lat;
        const lon = stepEl.dataset.lon;
        const badge = document.getElementById(`date-badge-${id}`);
        const arrivalDate = badge?.dataset.fullDate;

        const weather = await getWeather(lat, lon, arrivalDate);
        
        const weatherTd = document.getElementById(`weather-td-${id}`);
        if (weatherTd && weather.temp !== "--") {
            weatherTd.innerHTML = `
                <div class="flex items-center gap-2">
                    <img src="${weather.icon}" class="w-10 h-10" alt="weather">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-slate-700">${weather.temp}</span>
                        <span class="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                            <span class="text-orange-400">${weather.high}</span> / <span class="text-blue-300">${weather.low}</span>
                        </span>
                        <span class="text-[7px] text-slate-300 font-bold uppercase">Moy. 10 ans</span>
                    </div>
                </div>
            `;
        }
    }
}

async function getWeather(lat, lon, targetDate) {
    if (!targetDate) return { temp: "--", icon: "", high: "--", low: "--" };

    const monthDay = targetDate.substring(5); 
    const cacheKey = `10y_v2_${lat}_${lon}_${monthDay}`;
    if (weatherCache[cacheKey]) return weatherCache[cacheKey];

    await sleep(300); // Rate limit protection

    try {
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=2014-01-01&end_date=2024-12-31&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
        const resp = await fetch(url);
        
        if (resp.status === 429) {
            console.warn("Throttled. Waiting...");
            await sleep(1000); 
            return { temp: "...", icon: "", high: "", low: "" };
        }
        if (!resp.ok) throw new Error("Server error");
        
        const data = await resp.json();
        const daily = data.daily;
        let highs = [], lows = [];

        daily.time.forEach((dateStr, index) => {
            if (dateStr.endsWith(monthDay) && daily.temperature_2m_max[index] != null) {
                highs.push(daily.temperature_2m_max[index]);
                lows.push(daily.temperature_2m_min[index]);
            }
        });

        if (highs.length === 0) throw new Error("No data found");

        const avgHigh = Math.round(highs.reduce((a, b) => a + b) / highs.length);
        const avgLow = Math.round(lows.reduce((a, b) => a + b) / lows.length);
        const totalAvg = Math.round((avgHigh + avgLow) / 2);

        let iconCode = "01d"; 
        if (totalAvg > 28) iconCode = "01d"; 
        else if (totalAvg > 22) iconCode = "02d"; 
        else iconCode = "03d"; 

        const result = {
            temp: `${totalAvg}°C`,
            high: `${avgHigh}º`,
            low: `${avgLow}º`,
            icon: `https://openweathermap.org/img/wn/${iconCode}@2x.png`
        };

        weatherCache[cacheKey] = result;
        return result;
    } catch (e) {
        console.error("Climate API Error:", e);
        return { temp: "--", icon: "https://openweathermap.org/img/wn/01d@2x.png", high: "--", low: "--" };
    }
}

async function updateTableNotes(id, text) {
    if (isGuest) return;
    const sidebarTextarea = document.querySelector(`#step-${id} textarea`);
    if (sidebarTextarea) sidebarTextarea.value = text;
    await updateNotes(id, text);
}