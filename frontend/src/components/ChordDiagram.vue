<script>
import { defineComponent } from "vue";

const FRET_COUNT = 5;
const WIDTH = 90;
const HEIGHT = 100;
const MARGIN_TOP = 24;
const MARGIN_SIDE = 10;

export default defineComponent({
    props: {
        name: {
            type: String,
            required: true,
        },
        // Fret per string (low to high, matching the order the chord was defined in).
        // -1 = muted (X), 0 = open
        frets: {
            type: Array,
            default: () => [],
        },
        // Uniformly shrinks the whole card (svg, padding, label) so several
        // diagrams can be packed into a limited height without overflowing.
        scale: {
            type: Number,
            default: 1,
        },
    },
    data() {
        return { FRET_COUNT, WIDTH, HEIGHT, MARGIN_TOP, MARGIN_SIDE };
    },
    computed: {
        renderedWidth() {
            return WIDTH * this.scale;
        },
        renderedHeight() {
            return HEIGHT * this.scale;
        },
        stringCount() {
            return this.frets.length;
        },
        stringGap() {
            return this.stringCount > 1 ? (WIDTH - MARGIN_SIDE * 2) / (this.stringCount - 1) : 0;
        },
        fretHeight() {
            return (HEIGHT - MARGIN_TOP) / FRET_COUNT;
        },
        // Frets beyond the nut range (e.g. barre chords) - shift the diagram down
        baseFret() {
            const pressed = this.frets.filter((f) => f > 0);
            if (pressed.length === 0) {
                return 0;
            }
            const min = Math.min(...pressed);
            const max = Math.max(...pressed);
            if (max <= FRET_COUNT) {
                return 0;
            }
            return min - 1;
        },
        stringX() {
            return this.frets.map((_, i) => MARGIN_SIDE + i * this.stringGap);
        },
        dots() {
            return this.frets
                .map((fret, i) => ({ fret, x: this.stringX[i] }))
                .filter((d) => d.fret > 0)
                .map((d) => ({
                    ...d,
                    y: MARGIN_TOP + (d.fret - this.baseFret - 0.5) * this.fretHeight,
                }));
        },
    },
});
</script>

<template>
    <div class="chord-diagram" :style="{ padding: `${6 * scale}px ${8 * scale}px` }">
        <div class="chord-name" :style="{ fontSize: `${13 * scale}px`, marginBottom: `${2 * scale}px` }">{{ name }}</div>
        <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" :width="renderedWidth" :height="renderedHeight">
            <!-- Nut / base fret label -->
            <rect
                v-if="baseFret === 0"
                :x="MARGIN_SIDE"
                :y="MARGIN_TOP - 2"
                :width="WIDTH - MARGIN_SIDE * 2"
                height="3"
                class="nut"
            />
            <text v-else :x="MARGIN_SIDE - 6" :y="MARGIN_TOP + fretHeight * 0.5 + 4" class="base-fret">{{ baseFret + 1 }}fr</text>

            <!-- Fret lines -->
            <line
                v-for="i in FRET_COUNT + 1"
                :key="'fret' + i"
                :x1="MARGIN_SIDE"
                :x2="WIDTH - MARGIN_SIDE"
                :y1="MARGIN_TOP + (i - 1) * fretHeight"
                :y2="MARGIN_TOP + (i - 1) * fretHeight"
                class="fret-line"
            />

            <!-- Strings -->
            <line
                v-for="(x, i) in stringX"
                :key="'string' + i"
                :x1="x"
                :x2="x"
                :y1="MARGIN_TOP"
                :y2="HEIGHT"
                class="string-line"
            />

            <!-- Open / muted markers -->
            <text v-for="(fret, i) in frets" :key="'marker' + i" :x="stringX[i]" :y="MARGIN_TOP - 8" class="marker" text-anchor="middle">{{ fret === -1 ? "X" : fret === 0 ? "O" : "" }}</text>

            <!-- Fretted dots -->
            <circle v-for="(d, i) in dots" :key="'dot' + i" :cx="d.x" :cy="d.y" r="5" class="dot" />
        </svg>
    </div>
</template>

<style scoped lang="scss">
.chord-diagram {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    background-color: #32393e;
    border-radius: 4px;
    padding: 6px 8px;

    .chord-name {
        font-weight: bold;
        margin-bottom: 2px;
        color: #fff;
    }

    .nut {
        fill: #d6d6d6;
    }

    .fret-line, .string-line {
        stroke: #8a8f93;
        stroke-width: 1;
    }

    .base-fret {
        fill: #d6d6d6;
        font-size: 9px;
    }

    .marker {
        fill: #d6d6d6;
        font-size: 10px;
    }

    .dot {
        fill: #3131c6;
    }
}
</style>
