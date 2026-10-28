`timescale 1ns / 1ps

// 参数化二进制计数器：同步复位（高有效）+ 计数使能。
// 计到最大值后自然回绕到 0。
module counter #(
  parameter WIDTH = 4
) (
  input  logic             clk,
  input  logic             rst,  // 同步复位，高有效
  input  logic             en,   // 计数使能
  output logic [WIDTH-1:0] q
);

  always_ff @(posedge clk) begin
    if (rst)     q <= '0;
    else if (en) q <= q + 1'b1;
  end

endmodule
