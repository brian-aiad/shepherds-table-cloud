/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: false,
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#fff2f2",
          100: "#ffe2e2",
          200: "#ffc8c6",
          300: "#ff9e98",
          400: "#e8675f",
          500: "#c73a31",     // primary buttons
          600: "#8f0b04ff",   // navbar base
          700: "#990e07ff",   // deeper tone
          800: "#7a1a15",
          900: "#58110f",
          950: "#3a0b0a",
        },
        surface: {
          50:  "#ffffff",
          100: "#fafafa",
          200: "#f5f5f5",
          300: "#eeeeee",
        },
        text: {
          primary:   "#121212",
          secondary: "#4b5563",
          muted:     "#6b7280",
        },
        input: {
          bg:    "#ffffff",
          border:"#d1d5db",
          focus: "#c73a31",
        },
        outline: {
          light: "rgba(255,255,255,0.28)",
          faint: "rgba(255,255,255,0.16)",
        },
      },
      boxShadow: {
        soft: "0 6px 20px rgba(0,0,0,0.08)",
        insetTop: "inset 0 1px 0 rgba(255,255,255,0.08)",
      },
      borderRadius: {
        pill: "9999px",
        xl: "1rem",
        "2xl": "1.25rem",
      },
    },
  },

  plugins: [
    function ({ addBase, addUtilities, theme }) {
      // CSS variables for use in inline styles or utilities
      const brand = theme("colors.brand");
      addBase({
        ":root": {
          "--brand-50": brand[50],
          "--brand-100": brand[100],
          "--brand-200": brand[200],
          "--brand-300": brand[300],
          "--brand-400": brand[400],
          "--brand-500": brand[500],
          "--brand-600": brand[600],
          "--brand-700": brand[700],
          "--brand-800": brand[800],
          "--brand-900": brand[900],
        },

        // Page base
        body: {
          backgroundColor: theme("colors.surface.100"),
          color: theme("colors.text.primary"),
        },

        // Field defaults
        "input, textarea, select": {
          backgroundColor: theme("colors.input.bg"),
          color: theme("colors.text.primary"),
          borderColor: theme("colors.input.border"),
          borderWidth: "1px",
          borderRadius: theme("borderRadius.2xl"),
        },
        "input:focus, textarea:focus, select:focus": {
          outline: "none",
          borderColor: theme("colors.input.focus"),
          boxShadow: `0 0 0 3px ${theme("colors.brand.200")}`,
        },

        // 🔧 Chrome/Safari autofill fix (removes weird grey/blue highlight)
        "input:-webkit-autofill, textarea:-webkit-autofill, select:-webkit-autofill": {
          WebkitTextFillColor: theme("colors.text.primary"),
          caretColor: theme("colors.text.primary"),
          boxShadow: "0 0 0 1000px #fff inset",
          WebkitBoxShadow: "0 0 0 1000px #fff inset",
          transition: "background-color 9999s ease-out 0s",
        },
        "input:-webkit-autofill:focus, textarea:-webkit-autofill:focus, select:-webkit-autofill:focus": {
          outline: "none",
          borderColor: theme("colors.input.focus"),
          boxShadow: `0 0 0 3px ${theme("colors.brand.200")}, inset 0 0 0 1000px #fff`,
          WebkitBoxShadow: `0 0 0 3px ${theme("colors.brand.200")}, inset 0 0 0 1000px #fff`,
        },
      });

      // Reusable background gradients (same as navbar/login)
      addUtilities({
        ".bg-brand-gradient": {
          background:
            "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
        },
        ".bg-brand-gradient-sheen": {
          background:
            "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%), radial-gradient(600px 260px at -8% -10%, rgba(255,255,255,.45), transparent 60%), radial-gradient(520px 240px at 108% 120%, rgba(255,255,255,.35), transparent 60%)",
          backgroundBlendMode: "normal, screen, screen",
        },
        ".bg-brand-sheen": {
          background:
            "radial-gradient(600px 260px at -8% -10%, rgba(255,255,255,.45), transparent 60%), radial-gradient(520px 240px at 108% 120%, rgba(255,255,255,.35), transparent 60%)",
          backgroundBlendMode: "screen, screen",
        },

        // Buttons (solid + gradient)
        ".btn": {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          height: "2.75rem",
          paddingInline: "1.25rem",
          borderRadius: "1rem",
          fontSize: "0.875rem",
          fontWeight: "600",
          lineHeight: "1",
          transition:
            "background-color .15s ease, box-shadow .15s ease, transform .02s ease",
          userSelect: "none",
          whiteSpace: "nowrap",
        },
        ".btn:focus-visible": {
          outline: "none",
          boxShadow: `0 0 0 3px ${theme("colors.brand.200")}`,
        },

        ".btn-brand": {
          backgroundColor: "var(--brand-700)",
          color: "#fff",
          boxShadow: "0 1px 0 rgba(0,0,0,.15)",
        },
        ".btn-brand:hover": { backgroundColor: "var(--brand-600)" },
        ".btn-brand:active": {
          backgroundColor: "var(--brand-800)",
          transform: "translateY(0.5px)",
        },
        ".btn-brand:disabled": { opacity: ".6", cursor: "not-allowed" },

        ".btn-brand-grad": {
          background:
            "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 55%, var(--brand-500) 100%)",
          color: "#fff",
          boxShadow: "0 1px 0 rgba(0,0,0,.15)",
          backgroundSize: "100% 100%",
          backgroundPosition: "0% 50%",
        },
        ".btn-brand-grad:hover": {
          background:
            "linear-gradient(160deg, var(--brand-700) 0%, var(--brand-600) 45%, var(--brand-500) 95%)",
        },
        ".btn-brand-grad:active": {
          filter: "brightness(.98)",
          transform: "translateY(0.5px)",
        },
        ".btn-brand-grad:disabled": { opacity: ".6", cursor: "not-allowed" },

        ".btn-outline-light": {
          backgroundColor: "rgba(255,255,255,0.10)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.30)",
        },
        ".btn-outline-light:hover": {
          backgroundColor: "rgba(255,255,255,0.20)",
        },
        ".btn-outline-light:active": {
          backgroundColor: "rgba(255,255,255,0.25)",
        },
      });
    },
  ],
};
