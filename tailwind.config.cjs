/** @type {import('tailwindcss').Config} */
module.exports = {
  // We’re designing a light UI. Force light mode so Tailwind’s dark: variants don’t
  // accidentally flip colors based on the OS theme.
  darkMode: false,

  // Tell Tailwind where to scan for class usage.
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],

  theme: {
    extend: {
      /* ============================================================
         BRAND SYSTEM — Reds + Neutrals
         How we use these (keep this map in mind as you style):
         - brand.600  → Top navbar background (solid professional red)
         - brand.700  → Selector strip under the navbar; mobile panel bg
         - brand.500  → Primary/action fill (active nav pill, primary buttons)
         - brand.400  → Subtle hovers/tints on red backgrounds
         - brand.200  → Focus rings on white controls (selects/inputs)
         - outline.*  → White-ish outlines/rings used on dark red surfaces
         - surface.*  → App background layers (cards/pages)
         - text.*     → Default typography colors on light surfaces
         - input.*    → Defaults for <input>/<select>/<textarea>
         ============================================================ */
      colors: {
        brand: {
          50:  "#fff2f2",   // very light red tint (background highlights)
          100: "#ffe2e2",   // light red tint (pill hover on white)
          200: "#ffc8c6",   // focus ring color on inputs over white
          300: "#ff9e98",   // subtle dividers or light chips
          400: "#e8675f",   // hover states on brand surfaces
          500: "#c73a31",   // PRIMARY: active pills, primary buttons
          600: "#a70c04ff", // NAVBAR: solid top bar (enterprise look)
          700: "#8a0d06ff",   // SELECTOR STRIP: row under navbar / mobile panel
          800: "#7a1a15",   // deeper accents, pressed states on red
          900: "#58110f",   // darkest accents on red UIs
          950: "#3a0b0a",   // near-black red (rarely needed)
        },

        surface: {
          50:  "#ffffff", // primary card/background
          100: "#fafafa", // app page background
          200: "#f5f5f5", // subtle section backgrounds
          300: "#eeeeee", // separators / muted blocks
        },

        text: {
          primary:   "#121212", // default text on light surfaces
          secondary: "#4b5563", // labels, secondary info
          muted:     "#6b7280", // tertiary captions
        },

        input: {
          bg:    "#ffffff", // default control background
          border:"#d1d5db", // default control border
          focus: "#c73a31", // brand-aligned border on focus (also used below)
        },

        // Outlines used when controls sit on dark red bars (white-tinted rings)
        outline: {
          light: "rgba(255,255,255,0.28)", // standard ring on dark red
          faint: "rgba(255,255,255,0.16)", // lighter dividers/rings
        },
      },

      // Soft shadows and a faux “top highlight” used on the navbar
      boxShadow: {
        soft: "0 6px 20px rgba(0,0,0,0.08)",             // cards/forms
        insetTop: "inset 0 1px 0 rgba(255,255,255,0.08)" // subtle top sheen
      },

      // Shared radii (pill used for nav buttons + selects)
      borderRadius: {
        pill: "9999px", // nav pills, select pills
        xl: "1rem",     // large cards
        "2xl": "1.25rem",
      },
    },
  },

  /* =====================================================================
     BASE STYLES PLUGIN
     - Applies consistent defaults to inputs/selects/textareas app-wide.
     - Focus ring logic: keep borders clean but add a brand-tinted outer glow
       so controls are visible on both white and tinted surfaces.
     ===================================================================== */
  plugins: [
    function ({ addBase, theme }) {
      addBase({
        // Default field look across the app (white background controls)
        "input, textarea, select": {
          backgroundColor: theme("colors.input.bg"),       // white
          color: theme("colors.text.primary"),             // near-black text
          borderColor: theme("colors.input.border"),       // light gray border
          borderWidth: "1px",
          borderRadius: theme("borderRadius.2xl"),         // soft, friendly
        },

        // Accessible focus treatment: brand border + brand.200 outer ring
        "input:focus, textarea:focus, select:focus": {
          outline: "none",
          borderColor: theme("colors.input.focus"),        // brand.500 border
          boxShadow: `0 0 0 3px ${theme("colors.brand.200")}`, // outer ring
        },

        // Page background + default text
        body: {
          backgroundColor: theme("colors.surface.100"),    // light app BG
          color: theme("colors.text.primary"),
        },
      });
    },
  ],
};
