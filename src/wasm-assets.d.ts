// The application builder emits imported `.wasm` files as fingerprinted assets (angular.json
// `loader: { ".wasm": "file" }`), and the import evaluates to the asset's URL relative to the
// bundle. Declared by exact name: wasm-bindgen ships a `market_sim_bg.wasm.d.ts` describing the
// module's raw exports, and an exact ambient declaration takes precedence over that file.
declare module 'market-sim/market_sim_bg.wasm' {
  const url: string;
  export default url;
}
