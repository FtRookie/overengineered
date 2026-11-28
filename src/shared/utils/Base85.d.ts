// Basic Base85 module

interface Base85Module {
	Encode: (Input: buffer) => string;
	Decode: (Input: string) => buffer;
}
declare const Base85: Base85Module;
export = Base85;
