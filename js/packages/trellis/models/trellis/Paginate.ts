import Type, { type StaticDecode } from "typebox";

export const PaginateSchema = Type.Object({
  offset: Type.Integer({ minimum: 0, default: 0 }),
  limit: Type.Integer({ minimum: 0, default: 10 }),
});
export type Paginate = StaticDecode<typeof PaginateSchema>;
