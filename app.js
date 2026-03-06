// Plank Timer App with Firebase
import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, getDocs, deleteDoc, updateDoc, doc, query, orderBy } from './firebase-config.js';

const PARTICIPANTS = ['Lidia', 'Sasha', 'Lev', 'Egor'];

// State
let state = {
    isRunning: false,
    startTime: null,
    activeParticipants: new Set(PARTICIPANTS),
    currentRound: {},
    timerInterval: null,
    user: null,
    rounds: []
};

let viewingMonth = new Date();
let charts = {};
let selectedDate = null;

// Auth functions
function initAuth() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    loginBtn.addEventListener('click', async () => {
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error('Login error:', error);
            alert('Login failed: ' + error.message);
        }
    });

    logoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error('Logout error:', error);
        }
    });

    onAuthStateChanged(auth, async (user) => {
        const loading = document.getElementById('auth-loading');
        const loggedOut = document.getElementById('auth-logged-out');
        const loggedIn = document.getElementById('auth-logged-in');
        const userName = document.getElementById('user-name');
        const content = document.querySelector('.content');
        const tabs = document.querySelector('.tabs');

        loading.style.display = 'none';

        if (user) {
            state.user = user;
            loggedOut.style.display = 'none';
            loggedIn.style.display = 'flex';
            userName.textContent = user.displayName || user.email;
            content.classList.remove('app-disabled');
            tabs.classList.remove('app-disabled');

            // Load data from Firestore
            await loadRounds();
            renderCalendar();
            updateGraphs();
        } else {
            state.user = null;
            state.rounds = [];
            loggedOut.style.display = 'flex';
            loggedIn.style.display = 'none';
            content.classList.add('app-disabled');
            tabs.classList.add('app-disabled');
        }
    });
}

// Firestore functions
async function loadRounds() {
    if (!state.user) return;

    try {
        const roundsRef = collection(db, 'rounds');
        const q = query(roundsRef, orderBy('startTime', 'asc'));
        const snapshot = await getDocs(q);
        state.rounds = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error('Error loading rounds:', error);
    }
}

async function saveRound(roundData) {
    if (!state.user) return;

    try {
        const roundsRef = collection(db, 'rounds');
        const docRef = await addDoc(roundsRef, roundData);
        state.rounds.push({ id: docRef.id, ...roundData });
    } catch (error) {
        console.error('Error saving round:', error);
    }
}

async function deleteParticipantFromRound(roundId, participantName) {
    if (!state.user) return;

    try {
        const roundIndex = state.rounds.findIndex(r => r.id === roundId);
        if (roundIndex === -1) return;

        const round = state.rounds[roundIndex];
        delete round.participants[participantName];

        const roundRef = doc(db, 'rounds', roundId);

        if (Object.keys(round.participants).length === 0) {
            await deleteDoc(roundRef);
            state.rounds.splice(roundIndex, 1);
        } else {
            await updateDoc(roundRef, { participants: round.participants });
        }
    } catch (error) {
        console.error('Error deleting participant:', error);
    }
}

// Timer formatting
function formatTime(ms) {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const tenths = Math.floor((totalSeconds % 1) * 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}

function formatTimeShort(ms) {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Timer Tab
function initTimerTab() {
    const startBtn = document.getElementById('start-btn');
    const participantBtns = document.querySelectorAll('.participant-btn');

    startBtn.addEventListener('click', handleStartCancel);

    participantBtns.forEach(btn => {
        const participant = btn.closest('.participant').dataset.name;
        btn.addEventListener('click', () => handleParticipantClick(participant));
    });

    updateParticipantDisplay();
}

function handleStartCancel() {
    if (!state.isRunning) {
        startRound();
    } else {
        cancelRound();
    }
}

function startRound() {
    if (state.activeParticipants.size === 0) return;

    state.isRunning = true;
    state.startTime = Date.now();
    state.currentRound = {
        startTime: new Date().toISOString(),
        participants: {}
    };

    state.activeParticipants.forEach(name => {
        state.currentRound.participants[name] = null;
    });

    const startBtn = document.getElementById('start-btn');
    startBtn.textContent = 'Cancel';
    startBtn.classList.add('cancel');

    state.timerInterval = setInterval(updateTimer, 100);

    updateParticipantDisplay();
}

function cancelRound() {
    state.isRunning = false;
    state.startTime = null;
    state.currentRound = {};

    clearInterval(state.timerInterval);

    const startBtn = document.getElementById('start-btn');
    startBtn.textContent = 'Start';
    startBtn.classList.remove('cancel');

    document.getElementById('main-timer').textContent = '00:00.0';

    document.querySelectorAll('.participant-btn .time').forEach(el => {
        el.textContent = '';
    });

    updateParticipantDisplay();
}

function handleParticipantClick(name) {
    if (!state.isRunning) {
        if (state.activeParticipants.has(name)) {
            state.activeParticipants.delete(name);
        } else {
            state.activeParticipants.add(name);
        }
        updateParticipantDisplay();
    } else {
        if (state.activeParticipants.has(name) && state.currentRound.participants[name] === null) {
            const elapsed = Date.now() - state.startTime;
            state.currentRound.participants[name] = elapsed;

            const btn = document.querySelector(`.participant[data-name="${name}"] .participant-btn`);
            btn.querySelector('.time').textContent = formatTime(elapsed);
            btn.classList.remove('running');
            btn.classList.add('stopped');

            checkRoundComplete();
        }
    }
}

function checkRoundComplete() {
    const allStopped = Array.from(state.activeParticipants).every(
        name => state.currentRound.participants[name] !== null
    );

    if (allStopped) {
        completeRound();
    }
}

async function completeRound() {
    clearInterval(state.timerInterval);

    await saveRound(state.currentRound);

    setTimeout(() => {
        state.isRunning = false;
        state.startTime = null;
        state.currentRound = {};

        const startBtn = document.getElementById('start-btn');
        startBtn.textContent = 'Start';
        startBtn.classList.remove('cancel');

        document.getElementById('main-timer').textContent = '00:00.0';

        document.querySelectorAll('.participant-btn').forEach(btn => {
            btn.querySelector('.time').textContent = '';
            btn.classList.remove('stopped', 'running');
        });

        updateParticipantDisplay();
        renderCalendar();
        updateGraphs();
    }, 2000);
}

function updateTimer() {
    if (!state.isRunning) return;
    const elapsed = Date.now() - state.startTime;
    document.getElementById('main-timer').textContent = formatTime(elapsed);
}

function updateParticipantDisplay() {
    PARTICIPANTS.forEach(name => {
        const btn = document.querySelector(`.participant[data-name="${name}"] .participant-btn`);
        const isActive = state.activeParticipants.has(name);

        btn.classList.remove('active', 'inactive', 'running', 'stopped');

        if (state.isRunning) {
            if (isActive) {
                if (state.currentRound.participants[name] === null) {
                    btn.classList.add('running');
                } else {
                    btn.classList.add('stopped');
                }
            } else {
                btn.classList.add('inactive');
            }
        } else {
            btn.classList.add(isActive ? 'active' : 'inactive');
        }
    });
}

// History Tab
function initHistoryTab() {
    document.getElementById('prev-month').addEventListener('click', () => {
        viewingMonth.setMonth(viewingMonth.getMonth() - 1);
        renderCalendar();
    });

    document.getElementById('next-month').addEventListener('click', () => {
        viewingMonth.setMonth(viewingMonth.getMonth() + 1);
        renderCalendar();
    });

    renderCalendar();
}

function renderCalendar() {
    const roundDates = new Set(
        state.rounds.map(r => new Date(r.startTime).toDateString())
    );

    const year = viewingMonth.getFullYear();
    const month = viewingMonth.getMonth();

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('current-month').textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = (firstDay.getDay() + 6) % 7;

    const container = document.getElementById('calendar-days');
    container.innerHTML = '';

    const prevMonth = new Date(year, month, 0);
    for (let i = startPadding - 1; i >= 0; i--) {
        const day = document.createElement('button');
        day.className = 'calendar-day other-month';
        day.textContent = prevMonth.getDate() - i;
        container.appendChild(day);
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
        const date = new Date(year, month, d);
        const day = document.createElement('button');
        day.className = 'calendar-day';
        day.textContent = d;

        if (roundDates.has(date.toDateString())) {
            day.classList.add('has-rounds');
        }

        day.addEventListener('click', (e) => showDayDetails(date, e));
        container.appendChild(day);
    }

    const totalCells = startPadding + lastDay.getDate();
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remaining; i++) {
        const day = document.createElement('button');
        day.className = 'calendar-day other-month';
        day.textContent = i;
        container.appendChild(day);
    }
}

function showDayDetails(date, event) {
    selectedDate = date;
    const dateStr = date.toDateString();
    const dayRounds = state.rounds.filter(r =>
        new Date(r.startTime).toDateString() === dateStr
    );

    document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
    if (event && event.target) {
        event.target.classList.add('selected');
    }

    const details = document.getElementById('day-details');
    const dateDisplay = document.getElementById('selected-date');
    const roundsList = document.getElementById('rounds-list');

    dateDisplay.textContent = date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    if (dayRounds.length === 0) {
        roundsList.innerHTML = '<div class="empty-state">No rounds on this day</div>';
    } else {
        roundsList.innerHTML = dayRounds.map((round, index) => {
            const startTime = new Date(round.startTime).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            });

            const participants = Object.entries(round.participants)
                .map(([name, time]) => `
                    <div class="round-time" data-participant="${name}" data-round-id="${round.id}">
                        <span class="name">${name}</span>
                        <span class="duration">${formatTimeShort(time)}</span>
                        <button class="delete-btn" title="Delete ${name}'s entry">&#128465;</button>
                    </div>
                `).join('');

            return `
                <div class="round-item">
                    <div class="round-header">
                        <span>Round ${index + 1}</span>
                        <span>${startTime}</span>
                    </div>
                    <div class="round-times">${participants}</div>
                </div>
            `;
        }).join('');

        roundsList.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const roundTime = btn.closest('.round-time');
                const roundId = roundTime.dataset.roundId;
                const participantName = roundTime.dataset.participant;

                if (confirm(`Delete ${participantName}'s entry from this round?`)) {
                    await deleteParticipantFromRound(roundId, participantName);
                    renderCalendar();
                    showDayDetails(selectedDate, null);
                    updateGraphs();
                }
            });
        });
    }

    details.classList.add('visible');
}

// Graphs Tab
function initGraphsTab() {
    PARTICIPANTS.forEach(name => {
        const ctx = document.getElementById(`chart-${name}`).getContext('2d');
        charts[name] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Duration (seconds)',
                    data: [],
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#22c55e'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: '#888888',
                            maxRotation: 45,
                            minRotation: 45
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: '#888888',
                            callback: value => formatTimeShort(value * 1000)
                        },
                        beginAtZero: true
                    }
                }
            }
        });
    });

    updateGraphs();
}

function updateGraphs() {
    PARTICIPANTS.forEach(name => {
        const participantData = state.rounds
            .filter(r => r.participants[name] !== undefined && r.participants[name] !== null)
            .map(r => ({
                date: new Date(r.startTime),
                duration: r.participants[name] / 1000
            }));

        const labels = participantData.map(d =>
            d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        );
        const durations = participantData.map(d => d.duration);

        charts[name].data.labels = labels;
        charts[name].data.datasets[0].data = durations;
        charts[name].update();
    });
}

// Tab Navigation
function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(tab.dataset.tab).classList.add('active');

            if (tab.dataset.tab === 'history') {
                renderCalendar();
            } else if (tab.dataset.tab === 'graphs') {
                updateGraphs();
            }
        });
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initTabs();
    initTimerTab();
    initHistoryTab();
    initGraphsTab();
});
