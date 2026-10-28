/** 测试用的小设计 */
import type { SourceFile } from '@webeda/shared';

export const COUNTER: SourceFile = {
  name: 'design.sv',
  content: `module counter #(parameter W = 4) (
  input  logic         clk,
  input  logic         rst,
  output logic [W-1:0] q
);
  always_ff @(posedge clk)
    if (rst) q <= '0;
    else     q <= q + 1'b1;
endmodule
`,
};

export const COUNTER_TB: SourceFile = {
  name: 'testbench.sv',
  content: `module tb;
  logic clk = 0, rst = 1;
  logic [3:0] q;
  counter dut (.clk(clk), .rst(rst), .q(q));
  always #5 clk = ~clk;
  initial begin
    #12 rst = 0;
    #200;
    $display("q = %0d", q);
    $finish;
  end
endmodule
`,
};

export const SYNTAX_ERROR: SourceFile = {
  name: 'design.sv',
  content: `module broken(input clk, output reg [3:0] q);
  always @(posedge clk) q <= q + 1
endmodule
`,
};

export const HIER: SourceFile[] = [
  {
    name: 'rtl/adder.v',
    content: `module adder #(parameter W = 8) (input [W-1:0] a, b, output [W:0] s);
  assign s = a + b;
endmodule
`,
  },
  {
    name: 'rtl/top.v',
    content: `module top (input clk, input [7:0] x, y, output reg [8:0] sum, output [4:0] small);
  wire [8:0] s0;
  adder #(.W(8)) u_add (.a(x), .b(y), .s(s0));
  adder #(.W(4)) u_small (.a(x[3:0]), .b(y[3:0]), .s(small));
  mux2 u_mux (.a(x[0]), .b(y[0]), .s(clk), .y());
  always @(posedge clk) sum <= s0;
endmodule

module mux2 (input a, b, s, output y);
  assign y = s ? b : a;
endmodule
`,
  },
];

export const BLINKY: SourceFile = {
  name: 'blinky.v',
  content: `module top (input clk, output led_r, output led_g);
  reg [23:0] cnt = 0;
  always @(posedge clk) cnt <= cnt + 1;
  assign led_r = cnt[23];
  assign led_g = ~cnt[22];
endmodule
`,
};

export const ICEBREAKER_PCF: SourceFile = {
  name: 'icebreaker.pcf',
  content: `set_io clk 35
set_io led_r 11
set_io led_g 37
`,
};

/** 带异步低有效复位与使能的计数器（gatesim 正确性测试） */
export const ASYNC_COUNTER: SourceFile = {
  name: 'acount.v',
  content: `module acount #(parameter W = 8, parameter STEP = 1) (
  input clk,
  input rst_n,
  input en,
  output reg [W-1:0] q,
  output wire max,
  output wire ring_out
);
  reg [1:0] ring = 2'b01;
  always @(posedge clk or negedge rst_n)
    if (!rst_n) q <= 0;
    else if (en) q <= q + STEP;
  always @(posedge clk) ring <= {ring[0], ring[1]};
  assign max = &q;
  assign ring_out = ring[1];
endmodule
`,
};
