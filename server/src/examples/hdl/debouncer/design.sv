`timescale 1ns / 1ps

// 按键消抖：两级触发器同步 + 稳定计数。
//   输入必须连续 STABLE_CYCLES 个时钟保持新电平，输出才跟随变化。
//   真实硬件中 STABLE_CYCLES 一般取 5~20 ms 对应的时钟数（如 12 MHz × 10 ms = 120000）。
module debouncer #(
  parameter STABLE_CYCLES = 16
) (
  input  logic clk,
  input  logic rst,
  input  logic btn_in,    // 来自按键的原始（带抖动的异步）信号
  output logic btn_out,   // 消抖后的电平
  output logic pressed,   // 按下瞬间的单拍脉冲
  output logic released   // 松开瞬间的单拍脉冲
);
  localparam CW = $clog2(STABLE_CYCLES + 1);

  logic          sync0, sync1;
  logic [CW-1:0] cnt;

  // 两级同步，消除亚稳态
  always_ff @(posedge clk) begin
    if (rst) begin
      sync0 <= 1'b0;
      sync1 <= 1'b0;
    end else begin
      sync0 <= btn_in;
      sync1 <= sync0;
    end
  end

  // 与当前输出不同则计数，计满后才接受新电平；中途抖回去则清零
  always_ff @(posedge clk) begin
    if (rst) begin
      cnt     <= '0;
      btn_out <= 1'b0;
    end else if (sync1 == btn_out) begin
      cnt <= '0;
    end else if (cnt == CW'(STABLE_CYCLES - 1)) begin
      cnt     <= '0;
      btn_out <= sync1;
    end else begin
      cnt <= cnt + 1'b1;
    end
  end

  // 边沿检测
  logic btn_prev;
  always_ff @(posedge clk) begin
    if (rst) btn_prev <= 1'b0;
    else     btn_prev <= btn_out;
  end
  assign pressed  =  btn_out & ~btn_prev;
  assign released = ~btn_out &  btn_prev;
endmodule
