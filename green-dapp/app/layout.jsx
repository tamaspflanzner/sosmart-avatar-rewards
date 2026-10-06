import "./globals.css";
import "@account-kit/react/styles.css";
import Providers from "./providers";

export const metadata = {
  title: "Green Commute",
  description: "Demo stats + rewards + avatar shop",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
