`timescale 1ns / 1ps

// Hello World：最简单的设计——一个输出常数的模块。
// 在 Playground 中，design.sv 放可综合的设计，testbench.sv 放仿真激励。
module hello_world (
  output logic [7:0] answer
);
  assign answer = 8'd42;  // 生命、宇宙以及一切的答案
endmodule
