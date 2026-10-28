`timescale 1ns / 1ps

// 被测设计：3 级流水线有符号乘加器  y = a * b + c
//   每拍都可以输入一组新数据（in_valid），结果在 3 拍之后出现（out_valid）。
//   流水线结构：输入寄存 → 乘法 → 加法。
module pipe_mac #(
  parameter W = 8
) (
  input  logic                  clk,
  input  logic                  rst,
  input  logic                  in_valid,
  input  logic signed [W-1:0]   a,
  input  logic signed [W-1:0]   b,
  input  logic signed [2*W-1:0] c,
  output logic                  out_valid,
  output logic signed [2*W:0]   y
);
  // 第 1 级：寄存输入
  logic                  v1;
  logic signed [W-1:0]   a1, b1;
  logic signed [2*W-1:0] c1;
  // 第 2 级：乘法
  logic                  v2;
  logic signed [2*W-1:0] p2;
  logic signed [2*W-1:0] c2;

  always_ff @(posedge clk) begin
    if (rst) begin
      v1 <= 1'b0;
      v2 <= 1'b0;
      out_valid <= 1'b0;
    end else begin
      v1 <= in_valid;
      v2 <= v1;
      out_valid <= v2;
    end
  end

  always_ff @(posedge clk) begin
    a1 <= a;
    b1 <= b;
    c1 <= c;
    p2 <= a1 * b1;
    c2 <= c1;
    y  <= p2 + c2;   // 2W+1 位，不会溢出
  end
endmodule
