declare module "*.css";

declare module "*?raw&url" {
  const source: string;
  export default source;
}
