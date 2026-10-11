"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageBody, PageHeader } from "@/components/common"
import { ProductForm } from "@/components/product-form"

export function NewProductView() {
  const router = useRouter()
  return (
    <PageBody className="max-w-3xl">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/products" />} nativeButton={false}>
        <ArrowLeft />
        Products
      </Button>
      <PageHeader title="Add product" description="Fill in the details. Only the name, category and price are required." />
      <Card>
        <CardContent>
          <ProductForm onDone={(p) => router.push(`/products/${p.id}`)} onCancel={() => router.push("/products")} />
        </CardContent>
      </Card>
    </PageBody>
  )
}
