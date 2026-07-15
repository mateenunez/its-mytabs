<script>
import { defineComponent } from "vue";
import { releaseWakeLock, requestWakeLock } from "../app.js";
import ChordDiagram from "./ChordDiagram.vue";

// Must stay in sync with the .chords-panel grid rules below.
const CHORDS_GRID_ITEM_WIDTH = 112;
const CHORDS_GRID_GAP = 10;
// A ChordDiagram's natural (scale: 1) height: its 100px svg plus the name label and padding.
const CHORD_CARD_HEIGHT = 134;

export default defineComponent({
    components: { ChordDiagram },

    /**
     * @type {YT.Player}
     */
    youtubePlayer: null,

    props: {
        chordsData: {
            type: Object,
            default: null,
        },
        youtubeList: {
            type: Array,
            default: () => [],
        },
        tabID: {
            type: [String, Number],
            default: "",
        },
        isLoggedIn: {
            type: Boolean,
            default: false,
        },
        // Hides scroll/playback controls, used for the import preview
        readOnly: {
            type: Boolean,
            default: false,
        },
    },

    data() {
        return {
            source: "none",
            scrolling: false,
            youtubeManualScroll: false,
            speed: 40,
            fontSize: 15,
            activeDiagram: null,
            activeDiagramPos: { x: 0, y: 0 },
            chordsPanelWidth: 0,
            // Height of the lyrics scroll area (not the chords panel itself - the panel
            // has no content-independent height of its own, so measuring it would just
            // give back its own natural content height instead of the space available).
            lyricsContainerHeight: 0,
        };
    },

    computed: {
        hasChords() {
            return !!(this.chordsData && this.chordsData.lines && this.chordsData.lines.length > 0);
        },
        isYoutubeSource() {
            return this.source.startsWith("youtube-");
        },
        chordDefsList() {
            if (!this.chordsData || !this.chordsData.chordDefs) {
                return [];
            }
            return Object.entries(this.chordsData.chordDefs).map(([name, frets]) => ({ name, frets }));
        },
        // Mirrors the panel's `repeat(auto-fill, minmax(112px, 1fr))` grid so we know
        // how many rows the cards will wrap into before ever touching the DOM.
        chordsPanelColumns() {
            if (!this.chordsPanelWidth) {
                return 1;
            }
            return Math.max(1, Math.floor((this.chordsPanelWidth + CHORDS_GRID_GAP) / (CHORDS_GRID_ITEM_WIDTH + CHORDS_GRID_GAP)));
        },
        // Shrinks every ChordDiagram just enough that all rows fit inside the available
        // height instead of scrolling/overflowing on the Y axis.
        chordScale() {
            const count = this.chordDefsList.length;
            if (count === 0 || !this.lyricsContainerHeight) {
                return 1;
            }
            const rows = Math.ceil(count / this.chordsPanelColumns);
            if (rows <= 1) {
                return 1;
            }
            const requiredHeight = rows * CHORD_CARD_HEIGHT + (rows - 1) * CHORDS_GRID_GAP;
            if (requiredHeight <= this.lyricsContainerHeight) {
                return 1;
            }
            const scale = (this.lyricsContainerHeight - (rows - 1) * CHORDS_GRID_GAP) / (rows * CHORD_CARD_HEIGHT);
            return Math.max(0.45, Math.min(1, scale));
        },
        // Forces the panel to exactly match the lyrics area's rendered height (see
        // lyricsContainerHeight above) instead of shrinking to fit its own content.
        chordsPanelStyle() {
            return this.lyricsContainerHeight > 0 ? { height: `${this.lyricsContainerHeight}px` } : {};
        },
    },

    watch: {
        speed(newVal) {
            this.setSpeedConfig(newVal);
        },
        fontSize(newVal) {
            this.setFontSizeConfig(newVal);
        },
        source(newVal) {
            this.onSourceChange(newVal);
        },
        youtubeManualScroll(newVal) {
            if (!newVal) {
                this.stopManualScroll();
            }
        },
        chordDefsList() {
            this.$nextTick(() => this.observeLayout());
        },
    },

    mounted() {
        this.speed = this.getSpeedConfig();
        this.fontSize = this.getFontSizeConfig();
        this.$nextTick(() => this.observeLayout());
    },

    beforeUnmount() {
        this.stopYoutubePolling();
        this.stopManualScroll();
        this._chordsPanelObserver?.disconnect();
        this._lyricsContainerObserver?.disconnect();

        if (this.isYoutubeSource) {
            releaseWakeLock();
        }

        try {
            this.youtubePlayer?.destroy();
        } catch {
            // ignore
        }
    },

    methods: {
        getSpeedConfig() {
            const v = localStorage.getItem(`tab-${this.tabID}-chordsSpeed`);
            const parsed = v ? parseFloat(v) : NaN;
            return Number.isFinite(parsed) ? parsed : 40;
        },

        setSpeedConfig(v) {
            localStorage.setItem(`tab-${this.tabID}-chordsSpeed`, String(v));
        },

        getFontSizeConfig() {
            const v = localStorage.getItem(`tab-${this.tabID}-chordsFontSize`);
            const parsed = v ? parseFloat(v) : NaN;
            return Number.isFinite(parsed) ? parsed : 15;
        },

        setFontSizeConfig(v) {
            localStorage.setItem(`tab-${this.tabID}-chordsFontSize`, String(v));
        },

        // Tracks the chords panel's own width (for column count) and the lyrics
        // container's height (the target height to match/fit chords into) - both
        // change when the lyrics container is resized, or the window is.
        observeLayout() {
            this._chordsPanelObserver?.disconnect();
            this._lyricsContainerObserver?.disconnect();

            const panelEl = this.$refs.chordsPanel;
            if (panelEl) {
                this._chordsPanelObserver = new ResizeObserver(() => {
                    this.chordsPanelWidth = panelEl.offsetWidth;
                });
                this._chordsPanelObserver.observe(panelEl);
            }

            const lyricsEl = this.$refs.scrollContainer;
            if (lyricsEl) {
                this._lyricsContainerObserver = new ResizeObserver(() => {
                    this.lyricsContainerHeight = lyricsEl.offsetHeight;
                });
                this._lyricsContainerObserver.observe(lyricsEl);
            }
        },

        increaseFontSize() {
            this.fontSize = Math.min(this.fontSize + 2, 40);
        },

        decreaseFontSize() {
            this.fontSize = Math.max(this.fontSize - 2, 10);
        },

        selectSource(value) {
            this.source = value;
        },

        async onSourceChange(newSource) {
            this.stopYoutubePolling();
            this.stopManualScroll();
            this.youtubeManualScroll = false;

            if (newSource.startsWith("youtube-")) {
                await this.initYoutube(newSource.substring(8));
            }
        },

        toggleManualScroll() {
            this.scrolling = !this.scrolling;

            // While a YouTube video is playing, it already owns the wake lock via
            // onYoutubeStateChange; requesting/releasing it here too would let one
            // of the two turn it off under the other's feet.
            if (this.scrolling) {
                if (!this.isYoutubeSource) {
                    requestWakeLock();
                }
                this.startManualScrollLoop();
            } else {
                if (!this.isYoutubeSource) {
                    releaseWakeLock();
                }
                if (this._rafId) {
                    cancelAnimationFrame(this._rafId);
                }
            }
        },

        stopManualScroll() {
            if (this.scrolling) {
                this.scrolling = false;
                if (!this.isYoutubeSource) {
                    releaseWakeLock();
                }
            }
            if (this._rafId) {
                cancelAnimationFrame(this._rafId);
                this._rafId = null;
            }
        },

        startManualScrollLoop() {
            this._lastTs = null;
            this._scrollAccum = this.$refs.scrollContainer?.scrollTop ?? 0;
            this._lastSetScrollTop = this._scrollAccum;

            const step = (ts) => {
                if (!this.scrolling) {
                    return;
                }

                const el = this.$refs.scrollContainer;
                if (el) {
                    // If scrollTop moved on its own since the last frame, the user
                    // scrolled it manually (wheel/trackpad/touch) - pick up from
                    // there instead of snapping back and blocking their input.
                    if (this._lastSetScrollTop !== null && Math.abs(el.scrollTop - this._lastSetScrollTop) > 0.5) {
                        this._scrollAccum = el.scrollTop;
                    }

                    if (this._lastTs !== null) {
                        const dt = (ts - this._lastTs) / 1000;
                        // Accumulate fractional pixels ourselves: el.scrollTop rounds to
                        // whole pixels, so at low speeds each frame's sub-pixel delta
                        // would otherwise be discarded and the element would never move.
                        this._scrollAccum += this.speed * dt;
                        el.scrollTop = this._scrollAccum;
                        this._lastSetScrollTop = el.scrollTop;
                    }

                    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
                        this.scrolling = false;
                        if (!this.isYoutubeSource) {
                            releaseWakeLock();
                        }
                        return;
                    }
                }

                this._lastTs = ts;
                this._rafId = requestAnimationFrame(step);
            };

            this._rafId = requestAnimationFrame(step);
        },

        async initYoutube(videoID) {
            if (!this.youtubePlayer) {
                await this.initYoutubePlayer();
            }
            this.youtubePlayer.cueVideoById(videoID);
        },

        async initYoutubePlayer() {
            this.$refs.youtube.innerHTML = "";
            const playerElement = document.createElement("div");
            this.$refs.youtube.appendChild(playerElement);

            const isScriptLoaded = typeof YT !== "undefined";

            if (!isScriptLoaded) {
                const tag = document.createElement("script");
                tag.src = "https://www.youtube.com/player_api";
                const firstScriptTag = document.getElementsByTagName("script")[0];
                firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

                const youtubeApiReady = Promise.withResolvers();
                window.onYouTubePlayerAPIReady = youtubeApiReady.resolve;
                await youtubeApiReady.promise;
            }

            const playerReady = Promise.withResolvers();
            const player = new YT.Player(playerElement, {
                height: "180",
                width: "320",
                playerVars: { autoplay: 0 },
                events: {
                    onReady: () => playerReady.resolve(),
                    onStateChange: (e) => this.onYoutubeStateChange(e),
                },
            });
            await playerReady.promise;

            this.youtubePlayer = player;
        },

        onYoutubeStateChange(e) {
            switch (e.data) {
                case YT.PlayerState.PLAYING:
                    this.startYoutubePolling();
                    requestWakeLock();
                    break;
                case YT.PlayerState.PAUSED:
                case YT.PlayerState.ENDED:
                    this.stopYoutubePolling();
                    // Don't drop the wake lock out from under an active manual scroll.
                    if (!(this.youtubeManualScroll && this.scrolling)) {
                        releaseWakeLock();
                    }
                    break;
            }
        },

        startYoutubePolling() {
            this.stopYoutubePolling();
            this._youtubePollTimer = window.setInterval(() => {
                if (!this.youtubePlayer) {
                    return;
                }

                if (this.youtubeManualScroll) {
                    return;
                }

                const duration = this.youtubePlayer.getDuration();
                const current = this.youtubePlayer.getCurrentTime();
                const el = this.$refs.scrollContainer;

                if (el && duration > 0) {
                    const ratio = Math.min(current / duration, 1);
                    el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
                }
            }, 100);
        },

        stopYoutubePolling() {
            if (this._youtubePollTimer) {
                window.clearInterval(this._youtubePollTimer);
                this._youtubePollTimer = null;
            }
        },

        openDiagram(symbol, event) {
            if (this.activeDiagram === symbol) {
                this.closeDiagram();
                return;
            }

            this.activeDiagram = symbol;
            this.activeDiagramPos = {
                x: Math.min(event.clientX, window.innerWidth - 110),
                y: Math.min(event.clientY + 10, window.innerHeight - 130),
            };
        },

        closeDiagram() {
            this.activeDiagram = null;
        },
    },
});
</script>

<template>
    <div class="chords-view">
        <div v-if="!hasChords" class="empty-state">
            <p>No chords imported yet.</p>
            <router-link v-if="isLoggedIn && !readOnly" :to="`/tab/${tabID}/edit/chords`" class="btn btn-primary">
                Import Chords
            </router-link>
        </div>

        <template v-else>
            <div class="controls" v-if="!readOnly">
                <div class="source-selector">
                    <button class="btn btn-secondary" :class="{ active: source === 'none' }" @click="selectSource('none')">
                        No music (manual scroll)
                    </button>
                    <button
                        v-for="yt in youtubeList"
                        :key="yt.videoID"
                        class="btn btn-secondary"
                        :class="{ active: source === 'youtube-' + yt.videoID }"
                        @click="selectSource('youtube-' + yt.videoID)"
                    >
                        YouTube: {{ yt.videoID }}
                    </button>
                </div>

                <div v-if="source === 'none' || (isYoutubeSource && youtubeManualScroll)" class="manual-controls">
                    <button class="btn btn-primary" @click="toggleManualScroll">
                        {{ scrolling ? "Pause" : "Start" }} Scroll
                    </button>
                    <label class="speed-label">
                        Speed:
                        <input type="number" min="5" max="500" step="5" v-model.number="speed" class="form-control" />
                        px/s
                    </label>
                </div>

                <div v-show="isYoutubeSource" class="youtube-container">
                    <div ref="youtube" class="youtube-player"></div>
                    <label class="youtube-manual-toggle">
                        <input type="checkbox" v-model="youtubeManualScroll" />
                        Scroll manual (en vez de sincronizado con el video)
                    </label>
                </div>

                <div class="font-size-controls">
                    Text size:
                    <button class="btn btn-sm btn-secondary" @click="decreaseFontSize" :disabled="fontSize <= 10">A-</button>
                    <button class="btn btn-sm btn-secondary" @click="increaseFontSize" :disabled="fontSize >= 40">A+</button>
                </div>
            </div>

            <div class="scroll-area">
                <div
                    ref="scrollContainer"
                    class="lyrics-container"
                    :class="{ 'with-controls': !readOnly }"
                    :style="{ fontSize: fontSize + 'px' }"
                >
                <div class="line-block" v-for="(line, idx) in chordsData.lines" :key="idx">
                    <div class="chords-row">
                        <span
                            v-for="(c, ci) in line.chords"
                            :key="ci"
                            class="chord-symbol"
                            :style="{ left: c.column + 'ch' }"
                            @click="openDiagram(c.symbol, $event)"
                        >{{ c.symbol }}</span>
                    </div>
                    <div class="lyric-row">{{ line.lyric || " " }}</div>
                </div>
                </div>

                <div
                    v-if="chordDefsList.length"
                    ref="chordsPanel"
                    class="chords-panel"
                    :class="{ 'with-controls': !readOnly }"
                    :style="chordsPanelStyle"
                >
                    <ChordDiagram v-for="cd in chordDefsList" :key="cd.name" :name="cd.name" :frets="cd.frets" :scale="chordScale" />
                </div>
            </div>

            <div v-if="activeDiagram" class="diagram-overlay" @click="closeDiagram">
                <div class="diagram-popover" :style="{ left: activeDiagramPos.x + 'px', top: activeDiagramPos.y + 'px' }" @click.stop>
                    <ChordDiagram :name="activeDiagram" :frets="chordsData.chordDefs[activeDiagram] || []" />
                </div>
            </div>
        </template>
    </div>
</template>

<style scoped lang="scss">
@import "../styles/vars.scss";

.chords-view {
    width: 95%;
    margin: 0 auto;
    color: #d6d6d6;
}

.empty-state {
    text-align: center;
    padding: 60px 0;

    p {
        margin-bottom: 20px;
        color: #a4a4a4;
    }
}

.controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;

    .source-selector {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;

        .btn.active {
            background-color: $primary;
            border-color: $primary;
        }
    }

    .manual-controls {
        display: flex;
        align-items: center;
        gap: 10px;

        .speed-label {
            display: flex;
            align-items: center;
            gap: 6px;

            input {
                width: 80px;
            }
        }
    }

    .youtube-container {
        .youtube-player {
            width: 320px;
            height: 180px;
        }

        .youtube-manual-toggle {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 6px;
            font-size: 0.9em;
        }
    }

    .font-size-controls {
        display: flex;
        align-items: center;
        gap: 6px;
    }
}

.scroll-area {
    display: flex;
    align-items: flex-start;
    gap: 12px;

    @media (max-width: 700px) {
        flex-direction: column;
    }
}

.lyrics-container {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 70%;
    min-width: 240px;
    max-width: 100%;
    max-height: 65vh;
    overflow: auto;
    resize: horizontal;
    padding: 10px 5px 40px 5px;
    background-color: #1e1f22;
    border-radius: 4px;

    &.with-controls {
        max-height: 55vh;
    }

    @media (max-width: 700px) {
        width: 100% !important;
        resize: none;
    }
}

.chords-panel {
    flex: 1;
    min-width: 160px;
    box-sizing: border-box;
    display: grid;
    // 112px comfortably fits ChordDiagram's fixed 90px svg plus its own padding,
    // so cards never overflow their grid cell and swallow the gap below.
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    justify-items: center;
    align-content: flex-start;
    gap: 10px;
    // Same max-height rule as .lyrics-container (and its with-controls variant),
    // so the panel is always exactly as tall as the scroll area next to it.
    max-height: 65vh;
    overflow: hidden;
    padding: 4px;

    &.with-controls {
        max-height: 55vh;
    }

    @media (max-width: 700px) {
        max-height: none;
    }
}

.line-block {
    margin-bottom: 2px;
}

.chords-row {
    position: relative;
    height: 1.4em;
    font-family: "Courier New", Consolas, monospace;
    font-size: inherit;
}

.chord-symbol {
    position: absolute;
    top: 0;
    white-space: pre;
    font-weight: bold;
    color: $primary;
    cursor: pointer;

    &:hover {
        text-decoration: underline;
    }
}

.lyric-row {
    white-space: pre;
    font-family: "Courier New", Consolas, monospace;
    font-size: inherit;
    line-height: 1.4em;
}

.diagram-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
}

.diagram-popover {
    position: fixed;
    z-index: 2001;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    border-radius: 4px;
}
</style>
