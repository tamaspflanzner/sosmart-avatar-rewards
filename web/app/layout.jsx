import "./globals.css";
import "@account-kit/react/styles.css";
import Providers from "./providers";

export const metadata = {
  title: "sosmart Avatar Rewards",
  description: "Earn commuting rewards and personalize your avatar.",
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
