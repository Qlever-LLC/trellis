import Type from "typebox";

export const FilesUploadRequest = Type.Object({
  key: Type.String({ minLength: 1 }),
  contentType: Type.Optional(Type.String({ minLength: 1 })),
});

export const FilesUploadProgress = Type.Object({
  stage: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
});

export const FilesUploadResult = Type.Object({
  key: Type.String({ minLength: 1 }),
  size: Type.Integer({ minimum: 0 }),
  tempFilePath: Type.String({ minLength: 1 }),
});
