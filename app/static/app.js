// --- CONFIG & GLOBAL VARIABLES ---
const MAPBOX_TOKEN = window.MAPBOX_TOKEN;
const tripId = 1; 
let markersMap = {};
let routeLines = [];
let insertAtIndex = null;
let calendar;

// --- VIEW SWITCHER ---
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
    // Refresh table/calendar content whenever we switch to them
    updateAdvancedViews();
}

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

// --- INITIALIZE CALENDAR ---
document.addEventListener('DOMContentLoaded', () => {
    const calendarEl = document.getElementById('calendar-el');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        height: '100%',
        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
        eventColor: '#3b82f6',
        displayEventTime: false,
        eventDidMount: function(info) {
            info.el.title = info.event.title; // Show tooltip on hover
        }
    });
    loadItinerary();
});

// --- DATE CALCULATION & SYNC ---
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
        const timeVal = document.getElementById(`duration-input-${stepId}`)?.value || "00:00";
        const [hours] = timeVal.split(':').map(Number);

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
        
        // Store attributes for Table and Calendar sync
        badge.innerText = formattedDateFR; 
        badge.dataset.fullDate = calendarDate.toISOString().split('T')[0];
        badge.dataset.frenchDate = formattedDateFR;

        // Advance the calendar for the next city
        calendarDate.setDate(calendarDate.getDate() + nights);
        
        // Store when you leave this city (useful for calendar stretching)
        badge.dataset.departureDate = calendarDate.toISOString().split('T')[0];
    });

    updateAdvancedViews();
}

function updateAdvancedViews() {
    const tableBody = document.getElementById('table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    const events = [];
    
    const steps = Array.from(document.querySelectorAll('.step-container'));
    
    steps.forEach((stepEl, i) => {
        const id = parseInt(stepEl.id.replace('step-', ''));
        const city = stepEl.querySelector('.font-semibold').innerText;
        const badge = document.getElementById(`date-badge-${id}`);
        
        const arrivalDate = badge ? badge.dataset.fullDate : null;
        const departureDate = badge ? badge.dataset.departureDate : null;
        const frenchArrival = badge ? badge.dataset.frenchDate : "---";
        
        const nights = parseInt(document.getElementById(`nights-val-${id}`).innerText);
        const transport = document.querySelector(`#step-${id} .transport-select`).value;

        // 1. Table Sync
        tableBody.innerHTML += `
            <tr>
                <td class="text-center font-bold text-slate-400">${i+1}</td>
                <td class="font-bold">${city}</td>
                <td class="text-blue-600">${frenchArrival}</td>
                <td>${nights} nuits</td>
                <td>${transport}</td>
                <td><textarea onchange="updateTableNotes(${id}, this.value)">${stepEl.querySelector('textarea').value}</textarea></td>
            </tr>`;

        // 2. Calendar Sync with Gap Filling
        if (arrivalDate && departureDate) {
            let actualEnd = departureDate;

            // If there's a next city, we stretch this city until the next one arrives
            if (i < steps.length - 1) {
                const nextId = parseInt(steps[i+1].id.replace('step-', ''));
                const nextArrival = document.getElementById(`date-badge-${nextId}`)?.dataset.fullDate;
                if (nextArrival) {
                    actualEnd = nextArrival; // Stretch!
                }
            }

            events.push({ 
                title: `📍 ${city}`, 
                start: arrivalDate, 
                end: actualEnd, 
                allDay: true,
                backgroundColor: '#3b82f6',
                borderColor: '#2563eb'
            });
        }
    });

    if (calendar) {
        calendar.removeAllEvents();
        calendar.addEventSource(events);
    }
}

// Helper to sync table notes back to sidebar and DB
async function updateTableNotes(id, text) {
    // Update sidebar UI for consistency
    const sidebarTextarea = document.querySelector(`#step-${id} textarea`);
    if (sidebarTextarea) sidebarTextarea.value = text;
    
    // Save to DB
    await updateNotes(id, text);
}

// --- AUTOCOMPLETE & SEARCH LOGIC ---

const searchInput = document.getElementById('city-search');
const resultsContainer = document.getElementById('autocomplete-results');

searchInput.addEventListener('input', async (e) => {
    const query = e.target.value;
    if (query.length < 3) {
        resultsContainer.classList.add('hidden');
        return;
    }

    // Call Mapbox Geocoding API
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

// Function to save the new city to the Database
async function addStep(feature) {
    const [lon, lat] = feature.center;
    const cityName = feature.text;
    
    let countryName = "Inconnu";
    if (feature.context) {
        const countryContext = feature.context.find(c => c.id.startsWith('country'));
        if (countryContext) countryName = countryContext.text;
    }

    let position;
    if (insertAtIndex === null) {
        // Default: Add to the very end
        position = document.querySelectorAll('.step-container').length;
    } else {
        // Add at the specific chosen index
        position = insertAtIndex + 1;
    }

    const newStep = {
        city_name: cityName,
        country: countryName,
        lat: lat,
        lon: lon,
        position: position,
        nights: 1,
        transport_mode: 'voiture'
    };

    try {
        const response = await fetch(`/trips/${tripId}/steps/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newStep)
        });

        if (response.ok) {
            const savedStep = await response.json();
            
            // UI cleanup
            searchInput.value = '';
            resultsContainer.classList.add('hidden');
            
            // If we inserted, we should probably reload to ensure order is perfect,
            // otherwise, just render it.
            if (insertAtIndex !== null) {
                location.reload(); // Simplest way to fix indices after insertion
            } else {
                renderStep(savedStep);
            }
        }
    } catch (err) {
        console.error("Error adding step:", err);
    }
}

// Close search results if clicking outside
document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target)) resultsContainer.classList.add('hidden');
});

// --- DATABASE SYNC FUNCTIONS ---

// 1. Remove a step from DB and UI
async function removeStep(id) {
    if (!confirm("Supprimer cette étape ?")) return;

    try {
        const response = await fetch(`/steps/${id}`, { method: 'DELETE' });
        if (response.ok) {
            // Remove from HTML
            document.getElementById(`step-${id}`).remove();
            // Remove from Map
            if (markersMap[id]) {
                map.removeLayer(markersMap[id]);
                delete markersMap[id];
            }
            // Refresh logic
            recalculateNumbers();
            calculateRouting();
        }
    } catch (err) {
        console.error("Error deleting step:", err);
    }
}

// 2. Sync the new drag-and-drop order to the backend
async function syncOrderToBackend() {
    const stepElements = Array.from(document.querySelectorAll('.step-container'));
    const stepIds = stepElements.map(el => parseInt(el.id.replace('step-', '')));

    try {
        const response = await fetch('/steps/reorder', { // Matches your @app.put path
            method: 'PUT', // Matches your @app.put method
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stepIds) // Sends [5, 2, 8]
        });

        if (response.ok) {
            console.log("✅ Order saved successfully");
        } else {
            const errorData = await response.json();
            console.error("❌ Reorder failed:", errorData);
        }
    } catch (err) {
        console.error("Network error during reorder:", err);
    }
}

// 3. Handle the "+" button logic
function setInsertPosition(indexOrId) {
    // If we passed an ID (from the middle buttons), find the index
    if (typeof indexOrId === 'number' && indexOrId !== -1) {
        const steps = Array.from(document.querySelectorAll('.step-container'));
        insertAtIndex = steps.findIndex(el => el.id === `step-${indexOrId}`);
    } else {
        // This handles the -1 (Top) case directly
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
    document.getElementById('insert-label').classList.add('hidden');
}

// --- INITIALIZE DRAG & DROP ---
const listElement = document.getElementById('itinerary-list');
const sortable = new Sortable(listElement, {
    animation: 150,
    handle: '.drag-handle', // Ensure this class matches the HTML below
    onEnd: () => {
        recalculateNumbers();
        syncOrderToBackend();
        calculateRouting();
    }
});

// --- CORE RENDER FUNCTION ---
function renderStep(step) {
    const currentMode = step.transport_mode || 'voiture';
    const item = document.createElement('div');
    item.id = `step-${step.id}`;
    item.className = "step-container relative mb-2";

    item.innerHTML = `
        <div class="leg-info ml-14 mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
            <span class="text-[10px]">⏱ Trajet:</span>
            <input type="time" 
                id="duration-input-${step.id}" 
                name="duration"
                value="${step.duration || '00:00'}"
                class="bg-slate-50 border border-slate-200 rounded px-1 py-0.5 outline-none text-slate-600 focus:ring-1 focus:ring-blue-200"
                onchange="updateDuration(${step.id}, this.value)">
        </div>

        <div class="flex items-center gap-2 ml-auto">
            <div class="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1">
                <input type="checkbox" id="fix-check-${step.id}" 
                    ${step.is_fixed_date ? 'checked' : ''} 
                    onchange="toggleFixedDate(${step.id}, this.checked)"
                    class="w-3 h-3 text-blue-600">
                <label class="text-[9px] font-bold text-slate-400 uppercase">Anchor</label>
            </div>

            <input type="date" id="fixed-date-val-${step.id}" 
                value="${step.fixed_date || ''}"
                class="${step.is_fixed_date ? '' : 'hidden'} bg-blue-50 border border-blue-200 rounded text-[10px] p-0.5 outline-none"
                onchange="updateFixedDateValue(${step.id}, this.value)">

            <span id="date-badge-${step.id}" class="${step.is_fixed_date ? 'hidden' : ''} text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold"></span>
        </div>

        <div class="p-4 bg-white border border-slate-200 rounded-xl flex flex-col shadow-sm relative z-20">
            <div class="flex justify-between items-center w-full">
                <div class="flex items-center gap-3 cursor-pointer flex-grow" onclick="toggleTransport(${step.id})">
                    <div class="step-number-circle w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-100 flex-shrink-0">
                    </div>
                    <div class="flex flex-col">
                        <span class="font-semibold text-slate-700 leading-tight">${step.city_name}</span>
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
                        <button onclick="updateNights(${step.id}, -1)" class="text-slate-400 hover:text-blue-500 font-bold px-1">-</button>
                        <span id="nights-val-${step.id}" class="text-xs font-bold text-slate-700 w-3 text-center">${step.nights || 1}</span>
                        <button onclick="updateNights(${step.id}, 1)" class="text-slate-400 hover:text-blue-500 font-bold px-1">+</button>
                    </div>
                    
                    <span class="drag-handle text-slate-300 cursor-move p-1 hover:text-slate-500 transition-colors">⋮⋮</span>
                    
                    <button onclick="removeStep(${step.id})" class="text-slate-300 hover:text-red-400">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            </div>
            
            <textarea class="mt-3 w-full text-[11px] p-2 bg-slate-50 border-none rounded-lg text-slate-500 italic outline-none focus:ring-1 focus:ring-blue-100" 
                      placeholder="Notes..." onchange="updateNotes(${step.id}, this.value)">${step.notes || ''}</textarea>
        </div>

        <div class="insert-connector flex justify-center py-2 relative z-30">
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
    
    // Refresh Marker
    if (markersMap[step.id]) map.removeLayer(markersMap[step.id]);
    const marker = L.marker([step.lat, step.lon], { icon: customIcon }).addTo(map);
    markersMap[step.id] = marker;

    recalculateNumbers();
    calculateRouting();
}

// --- LOGIC HELPERS ---

function recalculateNumbers() {
    document.querySelectorAll('.step-number-circle').forEach((el, i) => el.innerText = i + 1);
}

function toggleTransport(id) {
    document.getElementById(`transport-container-${id}`).classList.toggle('hidden');
}

async function handleTransportChange(id, mode) {
    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transport_mode: mode })
    });
    calculateRouting();
}

async function updateNights(id, delta) {
    const el = document.getElementById(`nights-val-${id}`);
    let val = Math.max(0, parseInt(el.innerText) + delta);
    el.innerText = val;
    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nights: val })
    });
}

async function updateNotes(id, text) {
    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: text })
    });
}

async function calculateRouting() {
    routeLines.forEach(l => map.removeLayer(l));
    routeLines = [];
    const steps = Array.from(document.querySelectorAll('.step-container'));
    
    for (let i = 1; i < steps.length; i++) {
        const currId = parseInt(steps[i].id.replace('step-', ''));
        const prevId = parseInt(steps[i-1].id.replace('step-', ''));
        const mode = document.querySelector(`#step-${currId} .transport-select`).value;
        const input = document.getElementById(`duration-input-${currId}`);

        const start = markersMap[prevId].getLatLng();
        const end = markersMap[currId].getLatLng();

        if (['voiture', 'stop', 'bus', 'pied'].includes(mode)) {
            const profile = mode === 'pied' ? 'walking' : 'driving';
            try {
                const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${start.lng},${start.lat};${end.lng},${end.lat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`);
                const data = await res.json();
                
                // Draw line
                const line = L.polyline(data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]), { color: '#3b82f6', weight: 3, opacity: 0.5 }).addTo(map);
                routeLines.push(line);
                
                // Calculate Suggested Duration
                let dur = data.routes[0].duration;
                if (mode === 'stop') dur *= 1.5;
                if (mode === 'bus') dur *= 1.1;

                const h = Math.floor(dur / 3600);
                const m = Math.floor((dur % 3600) / 60);
                const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

                // Only overwrite if value is empty/default AND user hasn't touched it manually
                if ((input.value === "00:00" || input.value === "") && !input.dataset.userEdited) {
                    input.value = formatted;
                }
                
                calculateItineraryDates(); // Refresh calendar based on final input value
            } catch(e) { console.error("Route error", e); }
        } else {
            // Dash line for manual modes (Train/Ferry)
            const line = L.polyline([start, end], { color: '#cbd5e1', weight: 2, dashArray: '5, 10' }).addTo(map);
            routeLines.push(line);
            calculateItineraryDates();
        }
    }
}

async function updateDuration(id, value) {
    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: value })
    });
    calculateItineraryDates(); // Recalculate dates immediately
}

async function loadItinerary() {
    try {
        const res = await fetch(`/trips/${tripId}/steps/`);
        if (!res.ok) throw new Error("Failed to fetch itinerary");
        
        const steps = await res.json();
        
        // Clear current list to avoid duplicates
        listElement.innerHTML = ''; 
        
        steps.sort((a, b) => a.position - b.position).forEach(s => renderStep(s));
        
        if (steps.length > 0) {
            const group = new L.featureGroup(Object.values(markersMap));
            map.fitBounds(group.getBounds().pad(0.2));
            
            // Final step: Calculate dates now that everything is rendered
            calculateItineraryDates();
        }
    } catch (err) {
        console.error("Error loading itinerary:", err);
    }
}

async function toggleFixedDate(id, isChecked) {
    const dateInput = document.getElementById(`fixed-date-val-${id}`);
    const badge = document.getElementById(`date-badge-${id}`);
    
    // Toggle UI visibility
    dateInput.classList.toggle('hidden', !isChecked);
    badge.classList.toggle('hidden', isChecked);
    
    // If we just enabled it but it's empty, suggest the current calculated date
    if (isChecked && !dateInput.value) {
        // Convert badge text or current logic to YYYY-MM-DD
        dateInput.value = new Date().toISOString().split('T')[0]; 
    }

    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_fixed_date: isChecked, fixed_date: dateInput.value })
    });
    
    calculateItineraryDates();
}

async function updateFixedDateValue(id, value) {
    await fetch(`/steps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixed_date: value })
    });
    calculateItineraryDates();
}

window.addEventListener('DOMContentLoaded', loadItinerary);
