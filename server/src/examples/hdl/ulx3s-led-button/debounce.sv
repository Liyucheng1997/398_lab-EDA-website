`timescale 1ns / 1ps

// 按键消抖：两级同步 + 稳定计数。输入连续 CYCLES 个时钟保持新电平后输出才改变。
module debounce #(
  parameter CYCLES = 250_000      // 稳定时间对应的时钟数（≥ 1）
) (
  input  logic clk,
  input  logic in,                // 原始按键电平（异步）
  output logic out,               // 消抖后的电平
  output logic rise               // 由 0 变 1 时的单拍脉冲（按下瞬间）
);
  localparam CW = $clog2(CYCLES + 1);

  logic          s0 = 1'b0, s1 = 1'b0;
  logic [CW-1:0] cnt = '0;
  logic          level = 1'b0, level_d = 1'b0;

  always_ff @(posedge clk) begin
    s0 <= in;
    s1 <= s0;
    if (s1 == level) begin
      cnt <= '0;
    end else if (cnt >= CW'(CYCLES - 1)) begin
      cnt   <= '0;
      level <= s1;
    end else begin
      cnt <= cnt + 1'b1;
    end
    level_d <= level;
  end

  assign out  = level;
  assign rise = level & ~level_d;
endmodule
