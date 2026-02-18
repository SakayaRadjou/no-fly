// --- CONFIGURATION ---
// Centered on Bangkok [13.75, 100.5] with a zoom of 5 for SE Asia
const map = L.map('map').setView([13.7563, 100.5018], 5);
const tripId = 1; 
let markersMap = {}; 

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// --- INITIAL LOAD ---
// Fetch existing steps from the DB when the page opens
async function loadItinerary() {
    const response = await fetch(`/trips/${tripId}/steps/`);
    const steps = await response.json();
    steps.forEach(step => renderStep(step));
    
    // Auto-center map if there are points
    if (steps.length > 0) {
        const group = new L.featureGroup(Object.values(markersMap));
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

// --- AUTOCOMPLETE LOGIC ---
const searchInput = document.getElementById('city-search');
const resultsDiv = document.getElementById('autocomplete-results');

searchInput.addEventListener('input', async (e) => {
    const query = e.target.value;
    if (query.length < 3) {
        resultsDiv.classList.add('hidden');
        return;
    }

    // Search Nominatim for valid locations
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=5`);
    const data = await response.json();

    resultsDiv.innerHTML = '';
    resultsDiv.classList.remove('hidden');

    data.forEach(place => {
        const div = document.createElement('div');
        div.className = "p-2 hover:bg-slate-100 cursor-pointer text-sm border-b";
        div.textContent = place.display_name;
        div.onclick = () => {
            // Only here do we actually save to the DB
            saveStepToBackend(place.lat, place.lon, place.display_name.split(',')[0]);
            resultsDiv.classList.add('hidden');
            searchInput.value = '';
        };
        resultsDiv.appendChild(div);
    });
});

// Hide dropdown if clicked outside
document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target)) resultsDiv.classList.add('hidden');
});

// --- BACKEND SYNC ---
async function saveStepToBackend(lat, lon, cityName) {
    const response = await fetch(`/trips/${tripId}/steps/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            city_name: cityName,
            lat: parseFloat(lat),
            lon: parseFloat(lon),
            position: document.getElementById('itinerary-list').children.length
        })
    });
    const newStep = await response.json();
    renderStep(newStep);
}

// --- UI RENDERING ---
function renderStep(step) {
    const listElement = document.getElementById('itinerary-list');
    const emptyMsg = listElement.querySelector('p');
    if (emptyMsg) emptyMsg.remove();

    const marker = L.marker([step.lat, step.lon]).addTo(map)
        .bindPopup(`<b>${step.city_name}</b>`);
    markersMap[step.id] = marker;

    const item = document.createElement('div');
    item.id = `step-${step.id}`;
    item.className = "p-3 bg-white border rounded-lg flex justify-between items-center group shadow-sm cursor-move";
    item.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="text-slate-400">⋮⋮</span>
            <span class="font-medium text-slate-700">📍 ${step.city_name}</span>
        </div>
        <button onclick="removeStep(${step.id})" class="text-red-400 hover:text-red-600 p-1">✕</button>
    `;
    listElement.appendChild(item);
}

// --- DELETE ---
async function removeStep(stepId) {
    const response = await fetch(`/steps/${stepId}`, { method: 'DELETE' });
    if (response.ok) {
        map.removeLayer(markersMap[stepId]);
        delete markersMap[stepId];
        document.getElementById(`step-${stepId}`).remove();
    }
}

// Start the app
loadItinerary();