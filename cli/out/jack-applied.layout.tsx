import type { Metadata, Viewport } from 'next'
import { Fraunces, Libre_Franklin, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

// font-lab:start
// generated — re-run `font-lab apply` to update, `font-lab undo` to revert
const fontLabMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-jetbrains-mono" });
// font-lab:end

// Display: characterful humanist grotesque — warm, a little idiosyncratic.
const bricolage = Fraunces({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
})

// Body / UI: warm, highly readable humanist sans.
const hanken = Libre_Franklin({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Jack McGovern',
  description: 'Product Manager, Builder, Explorer. Driven by curiosity, grounded in human experience.',
  openGraph: {
    title: 'Jack McGovern',
    description: 'Product Manager, Builder, Explorer.',
    url: 'https://jack-mcgovern.com',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#fbfaf8',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${bricolage.variable} ${hanken.variable} ${fontLabMono.variable} font-sans antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
