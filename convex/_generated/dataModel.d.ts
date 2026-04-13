export type Id<TableName extends string = string> = string & { __tableName?: TableName };

export type Doc<TableName extends string = string> = {
  _creationTime: number;
  _id: Id<TableName>;
  [key: string]: any;
};
