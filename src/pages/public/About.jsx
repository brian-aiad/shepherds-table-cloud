import { NavLink } from "react-router-dom";
import logo from "../../assets/logo.png";

export default function About() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-[#c73a31] text-white py-4 shadow-md">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4">
          <NavLink to="/" className="flex items-center gap-3">
            <img src={logo} alt="Shepherds Table Cloud" className="h-10 w-10 rounded-md bg-white p-1 ring-1 ring-black/10" />
            <h1 className="text-xl font-semibold tracking-tight">Shepherds Table Cloud</h1>
          </NavLink>
          <nav className="flex gap-6 text-sm font-medium">
            <NavLink to="/pricing" className="hover:underline">Pricing</NavLink>
            <NavLink to="/login" className="hover:underline">Login</NavLink>
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="flex-grow max-w-4xl mx-auto px-4 py-12 text-gray-800">
        <h2 className="text-3xl font-bold mb-6 text-center">About Shepherds Table Cloud</h2>
        <p className="text-lg text-gray-600 leading-relaxed mb-8 text-center">
          Shepherds Table Cloud was created to simplify how food banks manage their daily work.
          From client sign-ins to USDA reporting, our platform helps organizations save time,
          stay compliant, and focus on what matters most — serving the community.
        </p>

        <div className="grid md:grid-cols-2 gap-8 text-gray-700">
          <div>
            <h3 className="font-semibold text-[#c73a31] mb-2">Our Mission</h3>
            <p>
              To empower food banks with simple, affordable technology that replaces
              spreadsheets and paper forms with modern, secure digital tools.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-[#c73a31] mb-2">Who We Serve</h3>
            <p>
              We work with food pantries, churches, and community organizations of all sizes —
              helping them manage clients, track visits, and generate reports effortlessly.
            </p>
          </div>
        </div>

        <div className="mt-10 text-center">
          <a
            href="mailto:support@shepherdstablecloud.com?subject=Request a Demo"
            className="inline-block bg-[#c73a31] text-white py-3 px-6 rounded-md font-medium hover:bg-[#a72825]"
          >
            Request a Demo
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-100 py-6 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} Shepherds Table Cloud — Built with care in California.
      </footer>
    </div>
  );
}
