`timescale 1ns / 1ps

// 序列检测器：检测串行输入中的 "1011"（允许重叠，如 1011011 中出现两次）。
// 同一功能分别用 Moore 型和 Mealy 型状态机实现，对比两者的区别：
//   Moore：输出只取决于当前状态，需要多一个状态，输出比 Mealy 晚一拍；
//   Mealy：输出取决于当前状态和当前输入，状态更少，响应更快。

module seq_detector_moore (
  input  logic clk,
  input  logic rst,
  input  logic din,
  output logic found
);
  typedef enum logic [2:0] {
    S_IDLE = 3'd0,  // 尚未匹配
    S_1    = 3'd1,  // 已匹配 "1"
    S_10   = 3'd2,  // 已匹配 "10"
    S_101  = 3'd3,  // 已匹配 "101"
    S_1011 = 3'd4   // 已匹配 "1011"（输出状态）
  } state_t;

  state_t state, next;

  always_ff @(posedge clk) begin
    if (rst) state <= S_IDLE;
    else     state <= next;
  end

  always_comb begin
    next = state;
    case (state)
      // 注：Icarus 中「?:」的结果不再是枚举类型，所以这里用 if/else
      S_IDLE:  if (din) next = S_1;    else next = S_IDLE;
      S_1:     if (din) next = S_1;    else next = S_10;
      S_10:    if (din) next = S_101;  else next = S_IDLE;
      S_101:   if (din) next = S_1011; else next = S_10;
      S_1011:  if (din) next = S_1;    else next = S_10;  // 重叠：末尾的 "1" 可作为下一次的开头
      default: next = S_IDLE;
    endcase
  end

  assign found = (state == S_1011);
endmodule

module seq_detector_mealy (
  input  logic clk,
  input  logic rst,
  input  logic din,
  output logic found
);
  typedef enum logic [1:0] {
    M_IDLE = 2'd0,
    M_1    = 2'd1,
    M_10   = 2'd2,
    M_101  = 2'd3
  } state_t;

  state_t state, next;

  always_ff @(posedge clk) begin
    if (rst) state <= M_IDLE;
    else     state <= next;
  end

  always_comb begin
    next = state;
    case (state)
      M_IDLE:  if (din) next = M_1;   else next = M_IDLE;
      M_1:     if (din) next = M_1;   else next = M_10;
      M_10:    if (din) next = M_101; else next = M_IDLE;
      M_101:   if (din) next = M_1;   else next = M_10;   // din=1 时同时输出 found
      default: next = M_IDLE;
    endcase
  end

  // 在 "101" 状态下又收到 1，当拍即输出
  assign found = (state == M_101) && din;
endmodule
