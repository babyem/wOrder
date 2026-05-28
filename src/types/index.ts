export type { Location, Employee, EmployeeWithLocations, Product, Order, OrderItem, OrderWithDetails } from './database'

import type { Product } from './database'

export interface CartItem {
  product_id: string
  product: Product
  quantity: number
}
