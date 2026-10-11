"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Camera, CameraOff, Keyboard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Html5QrcodeType = import("html5-qrcode").Html5Qrcode

/**
 * Camera scanner for QR codes and common barcodes (EAN, UPC, Code 128…).
 * Works on phones and laptops; the browser asks for camera permission.
 */
export function CameraScanner({ onDetected, active = true }: { onDetected: (code: string) => void; active?: boolean }) {
  const regionId = "scanner-" + useId().replace(/:/g, "")
  const scannerRef = useRef<Html5QrcodeType | null>(null)
  const onDetectedRef = useRef(onDetected)
  const [status, setStatus] = useState<"starting" | "running" | "error">("starting")
  const [error, setError] = useState("")

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let lastCode = ""
    let lastAt = 0

    ;(async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import("html5-qrcode")
        if (cancelled) return
        const scanner = new Html5Qrcode(regionId, {
          verbose: false,
          formatsToSupport: [
            F.QR_CODE,
            F.EAN_13,
            F.EAN_8,
            F.UPC_A,
            F.UPC_E,
            F.CODE_128,
            F.CODE_39,
            F.CODE_93,
            F.ITF,
            F.DATA_MATRIX,
          ],
        })
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: (w, h) => ({ width: Math.floor(w * 0.8), height: Math.floor(Math.min(h * 0.6, w * 0.5)) }) },
          (text) => {
            // Ignore the same code read repeatedly while it stays in view.
            const now = Date.now()
            if (text === lastCode && now - lastAt < 2500) return
            lastCode = text
            lastAt = now
            navigator.vibrate?.(60)
            onDetectedRef.current(text.trim())
          },
          undefined,
        )
        if (cancelled) await scanner.stop().catch(() => {})
        else setStatus("running")
      } catch (err) {
        if (cancelled) return
        setStatus("error")
        const message = err instanceof Error ? err.message : String(err)
        setError(
          /permission|notallowed/i.test(message)
            ? "Camera permission was denied. Allow camera access in your browser settings, or type the code instead."
            : /notfound|no camera|requested device/i.test(message)
              ? "No camera was found on this device. Type the code or use a USB scanner instead."
              : "The camera couldn't start. Make sure no other app is using it, or type the code instead.",
        )
      }
    })()

    return () => {
      cancelled = true
      const scanner = scannerRef.current
      scannerRef.current = null
      if (scanner?.isScanning) scanner.stop().then(() => scanner.clear()).catch(() => {})
    }
  }, [active, regionId])

  return (
    <div className="relative overflow-hidden rounded-xl border bg-black">
      <div id={regionId} className="aspect-[4/3] w-full [&_video]:h-full! [&_video]:w-full! [&_video]:object-cover" />
      {status === "starting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80">
          <Loader2 className="size-6 animate-spin" />
          Starting camera…
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted p-6 text-center text-sm text-muted-foreground">
          <CameraOff className="size-8" />
          {error}
        </div>
      )}
      {status === "running" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-center text-xs text-white">
          Point the camera at a QR code or barcode
        </div>
      )}
    </div>
  )
}

/** Text box for typing a code or using a USB/Bluetooth scanner (they "type" the code and press Enter). */
export function CodeInput({
  onSubmit,
  placeholder = "Type or scan a barcode / SKU and press Enter",
  autoFocus,
}: {
  onSubmit: (code: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [value, setValue] = useState("")
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const code = value.trim()
        if (!code) return
        onSubmit(code)
        setValue("")
      }}
    >
      <div className="relative flex-1">
        <Keyboard className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="h-10 pl-9 font-mono"
          autoFocus={autoFocus}
          inputMode="text"
          autoComplete="off"
        />
      </div>
      <Button type="submit" className="h-10" disabled={!value.trim()}>
        Look up
      </Button>
    </form>
  )
}

/** Small camera button that opens a scanner and returns the first code it reads. */
export function ScanButton({ onScan, label = "Scan" }: { onScan: (code: string) => void; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Camera />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan code</DialogTitle>
            <DialogDescription>Hold the barcode or QR code inside the frame.</DialogDescription>
          </DialogHeader>
          {open && (
            <CameraScanner
              onDetected={(code) => {
                setOpen(false)
                onScan(code)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
