`timescale 1ns / 1ps

// 移位寄存器：串入并出（SIPO），支持并行装载与左右移
module shift_register #(
  parameter W = 8
) (
  input  logic         clk,
  input  logic         rst,
  input  logic         load,      // 并行装载
  input  logic [W-1:0] d,
  input  logic         shift,     // 移位使能
  input  logic         dir,       // 0 = 左移（高位方向），1 = 右移
  input  logic         sin,       // 串行输入
  output logic [W-1:0] q,
  output logic         sout       // 串行输出（被移出的那一位）
);
  always_ff @(posedge clk) begin
    if (rst)        q <= '0;
    else if (load)  q <= d;
    else if (shift) q <= dir ? {sin, q[W-1:1]} : {q[W-2:0], sin};
  end

  assign sout = dir ? q[0] : q[W-1];
endmodule

// 8 位最大长度 LFSR（斐波那契型），本原多项式 x^8 + x^6 + x^5 + x^4 + 1
// 周期 = 2^8 - 1 = 255，全 0 是唯一的死锁态，所以复位到非零种子。
module lfsr8 #(
  parameter logic [7:0] SEED = 8'h01
) (
  input  logic       clk,
  input  logic       rst,
  input  logic       en,
  output logic [7:0] q
);
  logic feedback;
  assign feedback = q[7] ^ q[5] ^ q[4] ^ q[3];

  always_ff @(posedge clk) begin
    if (rst)     q <= SEED;
    else if (en) q <= {q[6:0], feedback};
  end
endmodule
